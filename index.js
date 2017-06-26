/*
 MIT License http://www.opensource.org/licenses/mit-license.php
 Author Tobias Koppers @sokra
 */

"use strict";

var jshint = require("jshint").JSHINT;
var RcLoader = require("rcloader");
var stripJsonComments = require("strip-json-comments");
var loaderUtils = require("loader-utils");
var fs = require("fs");

// 导入引用  add by seraphwu@20170626  begin

var path = require("path");
var crypto = require("crypto");
var appTools = require("hj-app-tools");

// 导入引用  add by seraphwu@20170626  end

// setup RcLoader
var rcLoader = new RcLoader(".jshintrc", null, {
    loader: function(path) {
        return path;
    }
});

function loadRcConfig(callback){
    var sync = typeof callback !== "function";

    if(sync){
        var path = rcLoader.for(this.resourcePath);
        if(typeof path !== "string") {
            // no .jshintrc found
            return {};
        } else {
            this.addDependency(path);
            var file = fs.readFileSync(path, "utf8");
            return JSON.parse(stripJsonComments(file));
        }
    }
    else {
        rcLoader.for(this.resourcePath, function(err, path) {
            if(typeof path !== "string") {
                // no .jshintrc found
                return callback(null, {});
            }

            this.addDependency(path);
            fs.readFile(path, "utf8", function(err, file) {
                var options;

                if(!err) {
                    try {
                        options = JSON.parse(stripJsonComments(file));
                    }
                    catch(e) {
                        err = new Error("Can't parse config file: " + path);
                    }
                }
                callback(err, options);
            });
        }.bind(this));
    }
}

function jsHint(input, options) {
    // copy options to own object
    if(this.options.jshint) {
        for(var name in this.options.jshint) {
            options[name] = this.options.jshint[name];
        }
    }

    // copy query into options
    var query = loaderUtils.getOptions(this) || {};
    for(var name in query) {
        options[name] = query[name];
    }


    // copy globals from options
    var globals = {};
    if(options.globals) {
        if(Array.isArray(options.globals)) {
            options.globals.forEach(function(g) {
                globals[g] = true;
            }, this);
        } else {
            for(var g in options.globals)
                globals[g] = options.globals[g];
        }
        delete options.globals;
    }

    // move flags
    var emitErrors = options.emitErrors;
    delete options.emitErrors;
    var failOnHint = options.failOnHint;
    delete options.failOnHint;

    // custom reporter
    var reporter = options.reporter;
    delete options.reporter;

    // module system globals
    globals.require = true;
    globals.module = true;
    globals.exports = true;
    globals.global = true;
    globals.process = true;
    globals.define = true;

    //初始化map --add by seraphwu@20170626      begin
    initMd5HashMap({
        options,
        globals,
        // emitErrors,
        // failOnHint,
        // reporter,
    });

    var releavePath = path.relative(this.options.context, this.resourcePath);
    var md5Hash = md5(input);
    if (md5HashMap[releavePath] == md5Hash) {
        //无变化，不检查
        // console.log("no change", releavePath)
        tryLogUnChangeNum();
        return;
    }
    tryLogChangedNum();
    //初始化map --add by seraphwu@20170626      end

    var source = input.split(/\r\n?|\n/g);
    var result = jshint(source, options, globals);

    //检查结果判断  --add by seraphwu@20170626     begin
    if(!result) {
        // console.log(releavePath, result)
        // 检查结果异常。
        md5HashMap[releavePath] = -1;
    } else {
        md5HashMap[releavePath] = md5Hash;
        // console.log("hj-hint:", releavePath)
    }
    tryWriteHashFile();
    //检查结果判断  --add by seraphwu@20170626     end

    var errors = jshint.errors;
    if(!result) {
        if(reporter) {
            reporter.call(this, errors);
        } else {
            var hints = [];
            if(errors) errors.forEach(function(error) {
                if(!error) return;
                var message = "  " + error.reason + " @ line " + error.line + " char " + error.character + "\n    " + error.evidence;
                hints.push(message);
            }, this);
            var message = hints.join("\n\n");
            var emitter = emitErrors ? this.emitError : this.emitWarning;
            if(emitter)
                emitter("jshint results in errors\n" + message);
            else
                throw new Error("Your module system doesn't support emitWarning. Update availible? \n" + message);
        }
    }
    if(failOnHint && !result)
        throw new Error("Module failed in cause of jshint error.");
}

module.exports = function(input, map) {
    this.cacheable && this.cacheable();
    var callback = this.async();

    if(!callback) {
        // load .jshintrc synchronously
        var config = loadRcConfig.call(this);
        jsHint.call(this, input, config);
        return input;
    }

    // load .jshintrc asynchronously
    loadRcConfig.call(this, function(err, config) {
        if(err) return callback(err);

        try {
            jsHint.call(this, input, config);
        }
        catch(e) {
            return callback(e);
        }
        callback(null, input, map);

    }.bind(this));
};


// add by seraphwu@20170626 begin
var md5HashMap = {};
var isInitMd5HashMap = false;
var md5HashFilePath = './.hjCheckResultTmp/hjHintResult.json';
var md5HashFileTimer = null;

var queryConfig = {};
var unChangeNum = 0;
var unChangeTimer = null;
var unChangeProcess = null;

var changedNum = 0;
var changedTimer = null;
var changedProcess = null;

/**
 * 文本计算md5，处理变更
 * @param str
 * @returns {string|Buffer}
 */
function md5(str) {
    return crypto.createHash('md5').update(str).digest("hex")
}

/**
 * 初始化 filePath- md5 map
 */
function initMd5HashMap(param) {
    if (isInitMd5HashMap) {
        return;
    }
    isInitMd5HashMap = true;
    var options = param.options || {};
    var globals = param.globals || {};

    queryConfig = {options, globals};
    //
    var isExist = fs.existsSync(md5HashFilePath);
    if (isExist) {
        //读取
        var jsonStr = fs.readFileSync(md5HashFilePath, 'utf8');
        try {
            //文件的json结构
            var jsonObj = JSON.parse(jsonStr) || {};

            //检查结果
            var fileResult = jsonObj.result || {};
            md5HashMap = JSON.parse(JSON.stringify(fileResult));
            // console.log("md5HashMap", md5HashMap)

            //queryConfig
            var config = jsonObj.config || {};

            //对比上次的配置与本次的配置， 如果配置不一致，则全部重新检查
            if (JSON.stringify(config) != JSON.stringify(queryConfig)) {
                // console.log("config", config)
                // console.log("queryConfig", queryConfig)
                md5HashMap = {};
            }
        }
        catch (e) {
            md5HashMap = {};
        }
    } else {
        //初始化
        md5HashMap = {};
    }
    // console.log(md5HashMap)
}

/**
 * 将map写文件，长久保存
 */
function tryWriteHashFile() {
    // console.log("try",md5HashMap)
    if (md5HashFileTimer) {
        clearTimeout(md5HashFileTimer);
        md5HashFileTimer = null;
    }

    md5HashFileTimer = setTimeout(function () {
        var result = md5HashMap;
        var config = queryConfig;
        appTools.writeToFile(md5HashFilePath, JSON.stringify({result, config}))
        //
    }, 800)
}

/**
 * 打印检测到的未变更数量，有个进度友好点
 */
function tryLogUnChangeNum() {
    //
    unChangeProcess = unChangeProcess || new appTools.ProgressMsg();
    unChangeNum++;

    if (unChangeTimer) {
        clearTimeout(unChangeTimer);
        unChangeTimer = null;
    }

    unChangeTimer = setTimeout(function () {
        //
        var isLast = !changedTimer;

        unChangeProcess.logMsg('hj-hint：检查到未变更文件:' + unChangeNum + " 这些文件不执行hint检查" + "         ");
    }, 800);

    if (unChangeNum % 8 == 0) {
        unChangeProcess.logMsg('hj-hint：检查到未变更文件:' + unChangeNum + " 这些文件不执行hint检查" + "         ")
    }

}

/**
 * 打印检测到的变更数量，有个进度友好点
 */
function tryLogChangedNum() {
    //
    changedProcess = changedProcess || new appTools.ProgressMsg();
    changedNum++;

    if (changedTimer) {
        clearTimeout(changedTimer);
        changedTimer = null;
    }

    changedTimer = setTimeout(function () {
        //
        var isLast = !unChangeTimer;

        changedProcess.logMsg('hj-hint：执行hint文件: ' + changedNum + "         ");
    }, 800);

    if (changedNum % 8 == 0) {
        changedProcess.logMsg('hj-hint：执行hint文件: ' + changedNum + "         ")
    }

}

// add by seraphwu@20170626 end