define(['text', 'nunjucks'], function (text, nunjucks) {

    var buildMap = {};
    var env = new nunjucks.Environment([]);

    var compiler = nunjucks.compiler;

    var pathToConfigure;
    var isConfigured = false;
    var commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
    var cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g;

    function compileTemplate(source) {
        var nunjucksCompiledStr = compiler.compile(source, env.asyncFilters, env.extensionsList);
        var reg = /env\.getTemplate\(\"(.*?)\"/g;
        var match;
        var required = {};
        var dependencies = [];
        var compiledTemplate = '\n';
        compiledTemplate += 'var nunjucks = require("nunjucks");\n';
        compiledTemplate += 'var env = new nunjucks.Environment([]);\n';
        // Add a dependencies object to hold resolved dependencies
        compiledTemplate += 'var dependencies = {};\n';
        if (pathToConfigure) {
            compiledTemplate += 'var configure = require("' + pathToConfigure + '")(env);\n';
        }

        while (match = reg.exec(nunjucksCompiledStr)) {
            var templateRef = match[1];
            if (!required[templateRef]) {
                 compiledTemplate += 'dependencies["' + templateRef + '"] = require( "nj!' + templateRef + '" );\n';
                required[templateRef] = 1;
            }
        }
        compiledTemplate += 'var shim = require("runtime-shim");\n';
        compiledTemplate += '\n\n\n\n';
        compiledTemplate += 'var obj = (function () {' + nunjucksCompiledStr + '})();\n';
        compiledTemplate += 'module.exports = shim(nunjucks, env, obj, dependencies);\n';

        compiledTemplate
            .replace(commentRegExp, '')
            .replace(cjsRequireRegExp, function (match, dependency) {
                dependencies.push(dependency);
            });

        return {
            compiledTemplate: compiledTemplate,
            dependencies: dependencies
        };
    }

    return {
        load: function (name, req, load, config) {
            pathToConfigure = pathToConfigure || config.nunjucks && config.nunjucks.configure;
            // load text files with text plugin
            text.get(req.toUrl(name), function (str) {
                req([pathToConfigure].filter(Boolean), function (configure) {
                    if (!isConfigured && pathToConfigure) {
                        isConfigured = true;
                        if (typeof configure !== 'function') {
                            if (requirejs.nodeRequire) {
                                configure = requirejs.nodeRequire(req.toUrl(pathToConfigure));
                            }
                            if (typeof configure !== 'function') {
                                throw new Error('config.nunjucks.configure is not a function');
                            }
                        }
                        configure(env);
                    }
                    try {
                        var obj = buildMap[name] = compileTemplate(str);
                    } catch (ex) {
                        console.log(ex.message);
                        throw ex;
                    }
                    if (!config.isBuild) {
                        req(obj.dependencies, function () {
                            load(new Function('require', 'exports', 'module', obj.compiledTemplate + 'return module.exports;')(req, {}, {}));
                        });
                    } else {
                        load(str);
                    }
                });
            });
        },

        write: function (pluginName, moduleName, writeModule) {
            if (moduleName in buildMap) {
                var deps = buildMap[moduleName].dependencies.map(function (dep) {
                    return '"' + dep + '"';
                });
                writeModule('define("' + pluginName + '!' + moduleName + '", ["require", "exports", "module", ' + deps.join(', ') + '], function ( require, exports, module ) { ' + buildMap[moduleName].compiledTemplate + ';});');
            }
        }

    };
});