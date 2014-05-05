/*
 * grunt-yomb
 * https://github.com/webyom/yomb.git
 *
 * Copyright (c) 2013 Gary Wang
 * Licensed under the MIT license.
 */

var os = require('os')
var fs = require('fs')
var path = require('path')
var exec = require('child_process').exec
var grunt = require('grunt')
var uglify = require('uglify-js')
var less = require('less')
var cssmin = require('cssmin').cssmin
var coffee = require('coffee-script')
var utils = require('./lib/utils')
var lang = require('./lib/lang')
var replaceProperties = require('./lib/properties').replaceProperties

process.on('uncaughtException', function(err) {
	try {
		if(err.filename) {//print less file
			log('Failed to build file: ' + err.filename, 1)
		}
		dealErr(err)
	} catch(e) {
	}
})

var EOL = '\n'
var EOLEOL = EOL + EOL
var DEFAULT_BUILD_JSON = {
	builds: [
		{
			input: './'
		}
	]
}

var startTime = new Date()
var charset = 'utf-8'
var buildDir = process.cwd()
var outputBasePath = ''
var htmlCompressorPath = path.join(path.dirname(module.filename), 'lib/html-compressor.jar')
var logs = []
var globalProtect = null
var globalAllowSrcOutput = false
var globalUglifyLevel = 0
var globalBuildTpl = false
var globalBuildNodeTpl = false
var globalCssmin = false
var globalCompressHtml = false
var globalCompressHtmlOptions = ''
var globalExclude = {}
var globalBanner = ''
var properties
var langResource
var coffeeOptions = {}
var done

function exit(code, type) {
	printLine()
	log((code ? 'Terminated' : 'Finished') + '! Spent ' + (new Date() - startTime) + 'ms', 0, true)
	printLine('+')
	if(type) {
		grunt.file.write(path.resolve(buildDir, 'yomb-' + type + '.log'), logs.join(os.EOL), {encoding: charset})
	}
	done && done(code ? false : true)
	done = null
}

function log(content, err, verbose) {
	logs.push(content)
	if(err || verbose || grunt.option('yomb-verbose')) {
		if(err) {
			grunt.log.error(content)
		} else {
			grunt.log.writeln(content)
		}
	}
}

function dealErr(err) {
	var content = err.toString()
	if(content == '[object Object]') {
		content = err.message || ''
	}
	logs.push(content)
	exit(1, 'error')
	grunt.fail.warn(err)
}

function printLine(c) {
	log(new Array(73).join('-').replace(/\-/g, c || '-'))
}

function getUnixStylePath(p) {
	return p.replace(/\\/g, '/')
}

function isPathProtected(path, protectedPath) {
	protectedPath = getUnixStylePath(protectedPath).replace(/\/$/, '');
	return new RegExp('^' + protectedPath + '(\\/|$)').test(getUnixStylePath(path))
}

function writeFileSync(toPath, content, encoding, langCode, skipProtectChecking) {
	var pathProtected = false
	var i, protectedPath
	if(globalProtect && !skipProtectChecking) {
		if(typeof globalProtect == 'string') {
			protectedPath = path.resolve(buildDir, globalProtect)
			pathProtected = isPathProtected(toPath, protectedPath)
		} else if(Array.isArray(globalProtect)) {
			for(i = 0; i < globalProtect.length; i++) {
				protectedPath = path.resolve(buildDir, globalProtect[i])
				pathProtected = isPathProtected(toPath, protectedPath)
				if(pathProtected) {
					break;
				}
			}
		}
	}
	if(pathProtected) {
		log('Warning: can not write file "' + toPath + '" as "' + protectedPath + '" is protected!', 1)
		return
	}
	if(properties) {
		properties._lang_ = langCode || undefined
		content = replaceProperties(content, properties)
		properties._lang_ = undefined
	}
	grunt.file.write(toPath, content, {encoding: encoding || charset})
}

function isSrcDir(outputDir) {
	if((/\/_?src(\/|$)/).test(getUnixStylePath(outputDir))) {//TODO
		return false
	}
	return true
}

function uglifyParse(content, opt) {
	opt = opt || {}
	var res
	try {
		res = uglify.parse(content)
	} catch(e) {
		var startLine = Math.max(1, e.line - 2)
		var maxLineNoLen = 0
		content = content.split(/\n|\r\n|\r/).slice(startLine - 1, e.line + 2)
		content.forEach(function(line, i) {
			var lineNo = (startLine + i) + (startLine + i == e.line ? ' ->' : '   ')  +  '| '
			maxLineNoLen = Math.max(maxLineNoLen, lineNo.length)
			content[i] = lineNo + line
		})
		content.forEach(function(line, i) {
			if(line.split('|')[0].length + 2 < maxLineNoLen) {
				content[i] = ' ' + line
			}
		})
		log('Failed to uglify JS content at line' + e.line + ' column' + e.col + (opt.files ? ', in file(s) ' + opt.files.join(', ') : '') + ': ' + EOL + content.join(EOL), 1)
		dealErr(e)
	}
	return res
}

function getUglified(content, info, opt) {
	opt = opt || {}
	var ast
	var level = typeof info.uglify != 'undefined' ? info.uglify : globalUglifyLevel
	var banner = info.banner || (opt.inline ? '' : globalBanner)
	if(!(/\S/).test(content)) {
		return ''
	}
	if(!level) {
		return banner + content
	} else {
		content = replaceProperties(content, properties)
	}
	ast = uglifyParse(content, {files: opt.files})
	if(level > 0) {
		ast.figure_out_scope()
		ast = ast.transform(uglify.Compressor({warnings: false}))
		content = ast.print_to_string()
	} else {
		content = ast.print_to_string({beautify: true})
	}
	return banner + content
}

function getBodyDeps(def) {
	var deps = []
	var got = {}
	def = def.replace(/(^|[^.]+?)\brequire\s*\(\s*(["'])([^"']+?)\2\s*\)/mg, function(full, lead, quote, dep) {
		var pDep = dep.replace(/\{\{([^{}]+)\}\}/g, "' + $1 + '")
		got[dep] || deps.push(pDep)
		got[dep] = 1
		if(pDep == dep) {
			return full
		} else {
			return lead + 'require(' + quote + pDep + quote + ')'
		}
	})
	return {
		def: def,
		deps: deps
	}
}

function getRelativeDeps(def, exclude) {
	var deps = []
	var got = {}
	var depArr = def.match(/(?:^|[^.]+?)\bdefine\s*\([^\[\{]*(\[[^\[\]]*\])/m)
	depArr = depArr && depArr[1]
	exclude = exclude || {}
	depArr && depArr.replace(/(["'])(\.[^"']+?)\1/mg, function(full, quote, dep) {
		got[dep] || exclude[dep] || globalExclude[dep] || deps.push(dep)
		got[dep] = 1
	})
	def.replace(/(?:^|[^.]+?)\brequire\s*\(\s*(["'])(\.[^"']+?)\1\s*\)/mg, function(full, quote, dep) {
		got[dep] || exclude[dep] || globalExclude[dep] || deps.push(dep)
		got[dep] = 1
	})
	return deps
}

function traversalGetRelativeDeps(inputDir, inputId, def, exclude, processed, curDir) {
	var deps = getRelativeDeps(def, exclude)
	var res = []
	var depId, fileName
	curDir = curDir || inputDir
	if(!processed) {
		if(!(/^\./).test(inputId)) {
			inputId = './' + inputId
		}
		processed = {}
		processed[inputId] = 1
	}
	while(deps.length) {
		depId = path.join(path.relative(inputDir, curDir), deps.shift())
		depId = path.relative(inputDir, path.join(inputDir, depId))
		depId = depId.split(path.sep).join('/')
		if(!(/^\./).test(depId)) {
			depId = './' + depId
		}
		if(processed[depId]) {
			continue
		} else {
			res.push(depId)
			processed[depId] = 1
		}
		if((/\.tpl\.html?$/).test(depId)) {
			fileName = path.resolve(curDir, depId)
		} else {
			fileName = path.resolve(curDir, depId + '.js')
		}
		def = fs.readFileSync(fileName, charset)
		res = traversalGetRelativeDeps(inputDir, depId, def, exclude, processed, path.dirname(fileName)).concat(res)
	}
	return res
}

function getTmplObjName(str) {
	var tmplObjName = (str + '').replace(/(?:[-_\.]+|(?:\.*\/)+)(\w)([^-_\.\/]*)/g, function($0, $1, $2) {return $1.toUpperCase() + $2})
	tmplObjName = tmplObjName.charAt(0).toLowerCase() + tmplObjName.slice(1)
	return tmplObjName
}

function getIncProcessed(input, info, callback, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var inputDir = path.dirname(input)
	var outputDir = opt.outputDir || inputDir
	var tmpl = opt.tmpl || fs.readFileSync(input, charset)
	var compressCss = typeof info.cssmin != 'undefined' ? info.cssmin : globalCssmin
	var reverseDepMap = utils.cloneObject(opt.reverseDepMap) || {}
	var asyncQueue = []
	var baseUrl, ugl
	if(reverseDepMap[input]) {
		log('Warn: "' + input + '" have circular reference!')
		callback('')
	}
	reverseDepMap[input] = 1
	if(info.lang) {
		tmpl = replaceProperties(tmpl, {_lang_: info.lang})
	}
	tmpl = replaceProperties(tmpl, properties)
	tmpl = tmpl.replace(/<!--\s*cssmin\s+(['"])([^'"]+)\1\s*-->/m, function(full, quote, val) {
		if(val == 'false' || val == '0') {
			compressCss = false
		} else {
			compressCss = true
		}
		return ''
	}).replace(/<!--\s*uglify\s+(['"])([^'"]+)\1\s*-->/m, function(full, quote, val) {
		ugl = parseInt(val)
		return ''
	}).replace(/<!--\s*base\s+(['"])([^'"]+)\1\s*-->/m, function(full, quote, base) {
		baseUrl = base.replace(/\/+$/, '')
		baseUrl = baseUrl && ("'" + baseUrl + "'")
		return ''
	}).replace(/<!--\s*include\s+(['"])([^'"]+)\1(?:\s+plain-id:([\w-]+))?\s*-->/mg, function(full, quote, file, plainId) {
		var res, extName
		var asyncMark = '<YOMB_INC_PROCESS_ASYNC_MARK_' + asyncQueue.length + '>'
		var ug = isNaN(ugl) ? info.uglify : ugl
		file = path.join(inputDir, file)
		extName = path.extname(file)
		log('Merging: ' + file)
		if((/\.(src|inc|tpl)\.html?$/).test(file)) {
			res = asyncMark
			asyncQueue.push({
				mark: asyncMark,
				processor: function(callback) {
					getIncProcessed(file, info, function(res) {
						callback(res)
					}, {reverseDepMap: reverseDepMap, outputDir: outputDir})
				}
			})
		} else if(extName == '.less') {
			res = [
				'<style type="text/css">',
					asyncMark,
				'</style>'
			].join(EOL)
			asyncQueue.push({
				mark: asyncMark,
				processor: function(callback) {
					compileLess(file, function(css) {
						callback(compressCss ? cssmin(css) : css)
					})
				}
			})
		} else {
			res = fs.readFileSync(file, charset)
			if(extName == '.js') {
				res = [
					plainId ? '<script type="text/plain" id="' + plainId + '">' : '<script type="text/javascript">',
					getUglified(res, {uglify: ug}, {inline: true, files: [file]}),
					'</script>'
				].join(EOL)
			} else if(extName == '.css') {
				res = [
					'<style type="text/css">',
					compressCss ? cssmin(res) : res,
					'</style>'
				].join(EOL)
			}
		}
		return res
	}).replace(/<!--\s*require\s+(['"])([^'"]+)\1(?:\s+plain-id:([\w-]+))?\s*-->/mg, function(full, quote, id, plainId) {
		var file = path.join(inputDir, id).replace(/\.js$/, '')
		if(!(/\.tpl\.html?$/).test(id)) {
			file += '.js'
		}
		var asyncMark = '<YOMB_INC_PROCESS_ASYNC_MARK_' + asyncQueue.length + '>'
		var ug = isNaN(ugl) ? info.uglify : ugl
		id = getUnixStylePath(id.replace(/\.js$/, ''))
		log('Merging: ' + file)
		asyncQueue.push({
			mark: asyncMark,
			processor: function(callback) {
				getBuiltAmdModContent(file, info, function(res) {
					res = getUglified([
						res,
						(/\brequire-plugin\b/).test(id) ? 'require.processDefQueue()' : 'require.processDefQueue(\'\', ' + (baseUrl || 'require.PAGE_BASE_URL') + ', require.getBaseUrlConfig(' + (baseUrl || 'require.PAGE_BASE_URL') + '))'
					].join(EOL), {uglify: ug}, {inline: true, files: [file]})
					callback(res)
				}, {id: id, reverseDepMap: reverseDepMap})
			}
		})
		return [
			plainId ? '<script type="text/plain" id="' + plainId + '">' : '<script type="text/javascript">',
				asyncMark,
			'</script>'
		].join(EOL)
	})
	;(function mergeOne() {
		var strict
		var asyncItem = asyncQueue.shift()
		if(asyncItem) {
			asyncItem.processor(function(res) {
				tmpl = tmpl.replace(new RegExp(asyncItem.mark, 'g'), function() {return res})
				mergeOne()
			})
		} else {
			tmpl = tmpl.replace(/(<script\b[^>]*>)([^\f]*?)(<\/script>)/mg, function(full, startTag, content, endTag) {
				var eol, ug
				startTag = startTag.replace(/\s+data-uglify=(['"])(\d+)\1/, function(full, quote, val) {
					ug = parseInt(val)
					return ''
				})
				content = content.replace(/^\s+$/, '')
				eol = content ? EOL : ''
				if(opt.tmpl && ug !== 0) {
					//beautify micro template inline script
					content = uglifyParse(content, {files: [input]}).print_to_string({beautify: true})
				}
				if(isNaN(parseInt(ug))) {
					ug = isNaN(ugl) ? info.uglify : ugl
				}
				if(ug === 0) {
					eol = ''
				}
				return startTag + eol + getUglified(content, {uglify: ug}, {inline: true, files: [input]}) + eol + endTag
			})
			if(info.lang) {
				tmpl = lang.replaceProperties(tmpl, langResource[info.lang])
			}
			if((/\.tpl\.html?$/).test(input)) {
				strict = (/(^|[^.]+)\B\$data\./).test(tmpl)
				tmpl = ['<%;(function() {%>', strict ? '' : '<%with($data) {%>', tmpl, strict ? '' : '<%}%>', '<%})();%>'].join(EOL)
			}
			callback(tmpl.replace(/\r\n/g, '\n'))
		}
	})()
}

function compileTmpl(input, type, info, callback, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var tmpl = fs.readFileSync(input, charset)
	getIncProcessed(input, info, function(processed) {
		var res = []
		var depPaths = ["'require'", "'exports'", "'module'"]
		var depSymbols = ['require', 'exports', 'module']
		var i
		tmpl = processed.replace(/<\/script>/ig, '</s<%=""%>cript>')
		if(type == 'NODE') {
			//do nothing
		} else if(type == 'AMD') {
			res.push([
				opt.id ?
				"define('" + opt.id + "', [" + depPaths.join(', ') + "], function(" + depSymbols.join(', ') + ") {" :
				"define(function(require, exports, module) {"
			].join(EOL))
		} else {
			res.push([
				"var " + getTmplObjName(opt.id) + " = (function() {",
				"	var exports = {};"
			].join(EOL))
		}
		// Tribute to MT by JR!
		res.push([
			"	function $encodeHtml(str) {",
			"		return (str + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x60/g, '&#96;').replace(/\x27/g, '&#39;').replace(/\x22/g, '&quot;');",
			"	}",
			"	exports.render = function($data, $opt) {",
			"		$data = $data || {};",
			"		var _$out_= [];",
			"		var $print = function(str) {_$out_.push(str);};",
			"		_$out_.push('" + tmpl
					.replace(/\r\n|\n|\r/g, "\v")
					.replace(/(?:^|%>).*?(?:<%|$)/g, function($0) {
						var uglifyLevel = typeof info.uglify != 'undefined' ? info.uglify : globalUglifyLevel
						if(type == 'NODE' && uglifyLevel <= 0) {
							return $0.replace(/('|\\)/g, "\\$1").replace(/[\v]/g, '\\n')
						} else {
							return $0.replace(/('|\\)/g, "\\$1").replace(/[\v\t]/g, "").replace(/\s+/g, " ")
						}
					})
					.replace(/[\v]/g, EOL)
					.replace(/<%==(.*?)%>/g, "', $encodeHtml($1), '")
					.replace(/<%=(.*?)%>/g, "', $1, '")
					.replace(/<%(<-)?/g, "');" + EOL + "		")
					.replace(/->(\w+)%>/g, EOL + "		$1.push('")
					.split("%>").join(EOL + "		_$out_.push('") + "');",
			"		return _$out_.join('');",
			"	};"
		].join(EOL).replace(/_\$out_\.push\(''\);/g, ''))
		if(type == 'NODE') {
			//do nothing
		} else if(type == 'AMD') {
			res.push([
				"})"
			].join(EOL))
		} else {
			res.push([
				"	return exports",
				"})()"
			].join(EOL))
		}
		res = res.join(EOL)
		if(opt.buildRoot && type == 'AMD') {
			getBuiltAmdModContent(input, info, function(res) {
				callback(uglifyParse(res, {files: [input]}).print_to_string({beautify: true}))
			}, {content: res})
		} else {
			if(type == 'AMD') {
				res = fixDefineParams(res, opt.id, opt.baseId)
			}
			callback(uglifyParse(res, {files: [input]}).print_to_string({beautify: true}))
		}
	}, utils.extendObject(opt, {tmpl: tmpl}))
}

function fixDefineParams(def, depId, baseId) {
	var bodyDeps
	def = getBodyDeps(def)
	bodyDeps = def.deps
	if(!(/(^|[^.]+?)\bdefine\s*\(/).test(def.def) && (/(^|[^.]+?)\bmodule\.exports\b/).test(def.def)) {
		def = [
			fix('define(', '', 'define(') + 'function(require, exports, module) {',
				def.def,
			'});'
		].join(EOL)
	} else {
		def = def.def.replace(/(^|[^.]+?)\b(define\s*\()\s*(?:(["'])([^"'\s]+)\3\s*,\s*)?\s*(\[[^\[\]]*\])?/m, fix)
	}
	function fix(full, b, d, quote, definedId, deps) {
		var id
		if(bodyDeps.length) {
			bodyDeps = "'" + bodyDeps.join("', '") + "'"
			if(deps) {
				deps = deps.replace(/]$/, ', ' + bodyDeps + ']')
			} else {
				deps = "['require', 'exports', 'module', " + bodyDeps + "], "
			}
		}
		if(definedId && !(/^\./).test(definedId)) {
			id = definedId
		} else {
			id = depId || ''
			id = id && baseId ? path.join(path.dirname(baseId), id) : id
			if(id && !(/^\./).test(id)) {
				id = './' + id
			}
		}
		return [b, d, id && ("'" + getUnixStylePath(id) + "', "), deps || "['require', 'exports', 'module'], "].join('')
	}
	return def
}

function getBuiltAmdModContent(input, info, callback, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var inputDir = path.dirname(input)
	var fileContent = []
	var deps, fileName, content
	var reverseDepMap = utils.cloneObject(opt.reverseDepMap) || {}
	if(reverseDepMap[input]) {
		log('Warn: "' + input + '" have circular reference!')
		return ''
	}
	reverseDepMap[input] = 1
	content = opt.content || fs.readFileSync(input, charset)
	deps = traversalGetRelativeDeps(inputDir, path.basename(input), content, info.exclude)
	;(function mergeOne() {
		var depId = deps.shift()
		if(depId) {
			if((/\.tpl\.html?$/).test(depId)) {
				fileName = path.resolve(inputDir, depId)
				if(reverseDepMap[fileName]) {
					log('Warn: "' + fileName + '" and "' + input + '" have circular reference!')
					mergeOne()
					return
				}
				log('Merging: ' + fileName)
				compileTmpl(fileName, 'AMD', info, function(res) {
					fileContent.push(res)
					mergeOne()
				}, {id: depId, baseId: opt.id, reverseDepMap: reverseDepMap})
			} else {
				fileName = path.resolve(inputDir, depId + '.js')
				if(reverseDepMap[fileName]) {
					log('Warn: "' + fileName + '" and "' + input + '" have circular reference!')
					mergeOne()
					return
				}
				log('Merging: ' + fileName)
				fileContent.push(fixDefineParams(fs.readFileSync(fileName, charset), depId, opt.id))
				mergeOne()
			}
		} else if((/\.tpl\.html?$/).test(input)) {
			compileTmpl(input, 'AMD', info, function(res) {
				fileContent.push(res)
				callback(fileContent.join(EOLEOL))
			}, {id: opt.id, reverseDepMap: opt.reverseDepMap})
		} else {
			fileContent.push(fixDefineParams(content, opt.id))
			callback(fileContent.join(EOLEOL))
		}
	})()
}

function compileLess(input, callback) {
	less.render(fs.readFileSync(input, charset), {
		paths: [path.dirname(input)], // Specify search paths for @import directives
		strictMaths: false,
		strictUnits: false,
		filename: input // Specify a filename, for better error messages
	}, function(err, css) {
		if(err) {
			dealErr(JSON.stringify(err))
		}
		callback(css)
	})
}

function checkCondition(condition) {
	var type, tmp
	if(!condition) {
		return true
	}
	tmp = condition.split(/\s*:\s*/)
	type = tmp[0]
	condition = tmp[1]
	if(type == 'property') {
		with(properties || {}) {
			return eval(condition)
		}
	}
	return true
}

function compileDirCoffee(info, callback, baseName) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	baseName = baseName || ''
	var inputDir = path.resolve(buildDir, info.input)
	var outputDir = typeof info.output == 'undefined' ? inputDir : path.resolve(buildDir, outputBasePath, info.output, baseName)
	var compileList = fs.readdirSync(inputDir)
	var ignore = info.ignore || {}
	if(!baseName/*avoid recalculating*/ && info.ignore) {
		ignore = {}
		for(var dir in info.ignore) {
			if(info.ignore.hasOwnProperty(dir)) {
				ignore[path.join(inputDir, dir)] = 1
			}
		}
	}
	compiles()
	function compiles() {
		var inputFile, outputFile, nodeTplOutputFile, fileName, langList, tmp
		if(compileList.length) {
			inputFile = path.resolve(inputDir, compileList.shift())
			if(ignore[inputFile] || (/^\.|~$/).test(path.basename(inputFile))) {
				compiles()
			} else if(path.extname(inputFile) == '.coffee') {
				fileName = path.basename(inputFile).replace(/\.coffee$/, '.js')
				outputFile = path.join(outputDir, fileName)
				compileOneCoffee(utils.extendObject(utils.cloneObject(info), {inputs: [inputFile], output: outputFile}), function() {
					compiles()
				}, true, true)
			} else if(fs.statSync(inputFile).isDirectory() && !(inputFile == outputDir || path.relative(inputFile, outputDir).indexOf('..') != 0)) {
				compileDirCoffee({input: inputFile, output: info.output, ignore: ignore}, function() {
					compiles()
				}, baseName ? baseName + '/' + path.basename(inputFile) : path.basename(inputFile))
			} else {
				compiles()
			}
		} else {
			callback()
		}
	}
}

function compileOneCoffee(info, callback, allowSrcOutput, skipProtectChecking) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	info.output = typeof info.output == 'undefined' ? info.inputs[0].replace(new RegExp(path.extname(info.inputs[0]) + '$'), '.js') : info.output
	var input, i, result, outputFilename
	var inputs = info.inputs
	var output = path.resolve(buildDir, outputBasePath, info.output)
	var outputDir = path.dirname(output)
	var codes = []
	var sources = []
	for(i = 0; i < inputs.length; i++) {
		input = path.resolve(buildDir, inputs[i])
		if(input == output) {
			printLine()
			log('Build')
			log('Input: ' + input)
			log('Output: ' + output)
			throw new Error('Input and output must not be the same!')
		}
		if(!grunt.file.exists(input)) {
			log('File "' + input + '" does not exists!')
			log('Done!')
			callback()
			return
		}
		codes.push(fs.readFileSync(input, charset))
		sources.push(getUnixStylePath(path.join(path.relative(path.dirname(info.output), path.dirname(inputs[i])), path.basename(input))))
	}
	printLine()
	log('Build')
	log('Input: ' + input)
	log('Output: ' + output)
	if(!globalAllowSrcOutput && !allowSrcOutput && !isSrcDir(outputDir)) {
		throw new Error('Output to src dir denied!')
	}
	outputFilename = path.basename(output)
	try {
		result = coffee.compile(codes.join(EOLEOL), utils.extendObject({
			filename: outputFilename,
			generatedFile: outputFilename,
			sourceFiles: sources
		}, coffeeOptions))
	} catch(e) {
		log('Failed to compile coffee script, error at line' + e.location.first_line + ': ' + inputs.join(', '), 1)
		dealErr(e)
	}
	if(coffeeOptions.sourceMap) {
		writeFileSync(output, result.js + EOL + '//@ sourceMappingURL=' + outputFilename + '.map', charset, null, skipProtectChecking)
		writeFileSync(output + '.map', result.v3SourceMap, charset, null, skipProtectChecking)
	} else {
		writeFileSync(output, result, charset, null, skipProtectChecking)
	}
	callback()
}

function buildOneDir(info, callback, baseName) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	baseName = baseName || ''
	var inputDir = path.resolve(buildDir, info.input)
	var outputDir = typeof info.output == 'undefined' ? inputDir : path.resolve(buildDir, outputBasePath, info.output, baseName)
	var buildList = fs.readdirSync(inputDir)
	var ignore = info.ignore || {}
	var buildNodeTpl = typeof info.buildNodeTpl != 'undefined' ? info.buildNodeTpl : globalBuildNodeTpl
	var compressCss = typeof info.cssmin != 'undefined' ? info.cssmin : globalCssmin
	if(!baseName/*avoid recalculating*/ && info.ignore) {
		ignore = {}
		for(var dir in info.ignore) {
			if(info.ignore.hasOwnProperty(dir)) {
				ignore[path.join(inputDir, dir)] = 1
			}
		}
	}
	build()
	function build() {
		var inputFile, outputFile, nodeTplOutputFile, fileName, langList, tmp
		if(buildList.length) {
			inputFile = path.resolve(inputDir, buildList.shift())
			if(ignore[inputFile] || (/^\.|~$/).test(path.basename(inputFile))) {
				build()
			} else if((/(^|[-_.])main\.js$/).test(path.basename(inputFile))) {
				fileName = path.basename(inputFile)
				outputFile = path.join(outputDir, fileName)
				if(inputFile == outputFile) {
					tmp = inputFile.match(/([-_.])main\.js$/)
					outputFile = outputFile.replace(/\.js$/, (tmp && tmp[1] || '-') + 'built.js')
				}
				buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					build()
				}, true)
			} else if((/(^|[-_.])main\.less$/).test(path.basename(inputFile))) {
				fileName = path.basename(inputFile).replace(/\.less$/, '.css')
				outputFile = path.join(outputDir, fileName)
				buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					build()
				}, true)
			} else if((/(^|[-_.])main\.tpl\.html?$/).test(path.basename(inputFile)) || globalBuildTpl && (/\.tpl\.html?$/).test(inputFile)) {
				fileName = path.basename(inputFile) + '.js'
				outputFile = path.join(outputDir, fileName)
				buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					build()
				}, true)
			} else if((/\.src\.html?$/).test(inputFile)) {
				fileName = path.basename(inputFile).replace(/\.src(\.html?)$/, '$1')
				if(langResource) {
					langList = langResource.LANG_LIST.concat()
					;(function() {
						var buildLang = arguments.callee
						var langCode = langList.shift()
						if(langCode) {
							outputFile = path.join(outputDir, fileName.replace(/(\.html?)$/, '-' + langCode + '$1'))
							buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile, lang: langCode}), function() {
								buildLang()
							}, true)
						} else {
							build()
						}
					})()
				} else {
					outputFile = path.join(outputDir, fileName)
					buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
						build()
					}, true)
				}
			} else if(compressCss && path.extname(inputFile) == '.css' && !(/-min\.css$/).test(inputFile)) {
				fileName = path.basename(inputFile).replace(/\.css$/, '-min.css')
				outputFile = path.join(outputDir, fileName)
				printLine()
				log('Build')
				log('Input: ' + inputFile)
				log('Output: ' + outputFile)
				tmp = fs.readFileSync(inputFile, charset)
				log('Merging: ' + inputFile)
				tmp = cssmin(tmp)
				log('Writing: ' + outputFile)
				writeFileSync(outputFile, tmp, charset)
				log('Done!')
				build()
			} else if(fs.statSync(inputFile).isDirectory() && !(inputFile == outputDir || path.relative(inputFile, outputDir).indexOf('..') != 0)) {
				buildOneDir({input: inputFile, output: info.output, exclude: info.exclude, ignore: ignore, buildNodeTpl: buildNodeTpl, cssmin: compressCss}, function() {
					build()
				}, baseName ? baseName + '/' + path.basename(inputFile) : path.basename(inputFile))
			} else {
				build()
			}
		} else {
			callback()
		}
	}
}

function buildOne(info, callback, allowSrcOutput) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	var input = path.resolve(buildDir, info.input)
	var output = typeof info.output == 'undefined' ? '' : path.resolve(buildDir, outputBasePath, info.output)
	var outputDir = path.dirname(output)
	var buildNodeTpl = typeof info.buildNodeTpl != 'undefined' ? info.buildNodeTpl : globalBuildNodeTpl
	var compressCss = typeof info.cssmin != 'undefined' ? info.cssmin : globalCssmin
	var compressHtml = typeof info.compressHtml != 'undefined' ? info.compressHtml : globalCompressHtml
	var compressHtmlOptions = typeof info.compressHtmlOptions != 'undefined' ? info.compressHtmlOptions : globalCompressHtmlOptions
	var nodeTplOutput
	if(input == output) {
		printLine()
		log('Build')
		log('Input: ' + input)
		log('Output: ' + output)
		throw new Error('Input and output must not be the same!')
	}
	if(!grunt.file.exists(input)) {
		log('File "' + input + '" does not exists!')
		log('Done!')
		callback()
		return
	}
	printLine()
	log('Build')
	log('Input: ' + input)
	log('Output: ' + output)
	if(!output) {
		throw new Error('Output not defined!')
	}
	if(!globalAllowSrcOutput && !allowSrcOutput && !isSrcDir(outputDir)) {
		throw new Error('Output to src dir denied!')
	}
	if((/\.tpl\.html?$/).test(input)) {
		if(buildNodeTpl) {
			nodeTplOutput = output.replace('.tpl.', '.node.tpl.')
			log('Output: ' + nodeTplOutput)
		}
		log('Merging: ' + output)
		compileTmpl(input, 'AMD', info, function(res) {
			res = getUglified(res, info, {files: [input]})
			log('Writing: ' + output)
			writeFileSync(output, res, charset)
			if(buildNodeTpl) {
				log('Merging: ' + nodeTplOutput)
				compileTmpl(input, 'NODE', info, function(res) {
					res = getUglified(res, info, {files: [input]})
					log('Writing: ' + nodeTplOutput)
					writeFileSync(nodeTplOutput, res, charset)
					log('Done!')
					callback()
				})
			} else {
				log('Done!')
				callback()
			}
		}, {buildRoot: true})
	} else if((/\.src\.html?$/).test(input)) {
		log('Merging: ' + input)
		getIncProcessed(input, info, function(res) {
			log('Writing: ' + output)
			writeFileSync(output, res, charset, info.lang)
			if(compressHtml) {
				exec('java -jar ' + htmlCompressorPath + ' ' + compressHtmlOptions + ' ' + output, function(err, stdout, stderr) {
					if(err) {
						log('Compress HTML error in file ' + input, 1)
						dealErr(err)
					} else {
						writeFileSync(output, stdout, charset)
						log('Done!')
						callback()
					}
				})
			} else {
				log('Done!')
				callback()
			}
		}, {outputDir: outputDir})
	} else if(path.extname(input) == '.less') {
		log('Merging: ' + input)
		compileLess(input, function(css) {
			log('Writing: ' + output)
			if(compressCss) {
				css = cssmin(css)
			}
			writeFileSync(output, css, charset)
			log('Done!')
			callback()
		})
	} else {
		log('Merging: ' + input)
		getBuiltAmdModContent(input, info, function(res) {
			res = getUglified(res, info, {files: [input]})
			log('Writing: ' + output)
			writeFileSync(output, res, charset)
			log('Done!')
			callback()
		})
	}
}

function combineOne(info, callback) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	printLine()
	log('Combine')
	if(!info.dest) {
		throw new Error('Output not defined!')
	}
	var output = path.resolve(buildDir, outputBasePath, info.dest)
	var outputDir = path.dirname(output)
	var compressCss = typeof info.cssmin != 'undefined' ? info.cssmin : globalCssmin
	var fileContent = []
	log('Output: ' + output)
	if(!globalAllowSrcOutput && !isSrcDir(outputDir)) {
		throw new Error('Output to src dir denied!')
	}
	;(function() {
		var combineNext = arguments.callee
		var depId, fileName
		if(info.src.length) {
			depId = info.src.shift()
			if(!grunt.file.exists(depId)) {
				combineNext()
				return
			}
			fileName = path.resolve(buildDir, depId)
			log('Merging: ' + fileName)
			if((/\.tpl\.html?$/).test(depId)) {
				compileTmpl(fileName, 'NONE_AMD', info, function(res) {
					fileContent.push(res)
					combineNext()
				})
			} else if(path.extname(fileName) == '.less' && path.extname(output) == '.css') {
				compileLess(fileName, function(css) {
					fileContent.push(css)
					combineNext()
				})
			} else if(path.extname(fileName) == '.css' && compressCss) {
				fileContent.push(cssmin(fs.readFileSync(fileName, charset)))
				combineNext()
			} else if(path.extname(fileName) == '.js') {
				fileContent.push(getUglified(fs.readFileSync(fileName, charset), info, {files: [fileName]}))
				combineNext()
			} else {
				fileContent.push(fs.readFileSync(fileName, charset))
				combineNext()
			}
		} else {
			log('Writing: ' + output)
			writeFileSync(output, fileContent.join(EOLEOL), charset)
			log('Done!')
			callback()
		}
	})()
}

function copyOne(info, callback, _deep) {
	if(!checkCondition(info.condition)) {
		callback()
		return
	}
	if(!info.input) {
		printLine()
		log('Copy')
		throw new Error('Input not defined!')
	}
	if(!info.output) {
		printLine()
		log('Copy')
		throw new Error('Output not defined!')
	}
	if(!grunt.file.exists(info.input)) {
		callback()
		return
	}
	var fileName = path.basename(info.input)
	var includeRegexp = info.includeRegexp
	var excludeRegexp = info.excludeRegexp
	var input = path.resolve(buildDir, info.input)
	var output = path.resolve(buildDir, outputBasePath, info.output)
	var outputDir = path.dirname(output)
	var copyList, content
	if(input == output) {
		return
	}
	if(fs.statSync(input).isDirectory()) {
		if(_deep && (fileName == 'node_modules' || (/^\.[^\/\\]+/).test(fileName))) {
			callback()
			return
		}
		copyList = fs.readdirSync(input)
		copy()
	} else {
		if(_deep && (/^\.[^\/\\]+|[~]$/).test(fileName)) {
			callback()
			return
		}
		printLine()
		log('Copy')
		log('Input: ' + input)
		log('Output: ' + output)
		if(!globalAllowSrcOutput && !isSrcDir(outputDir)) {
			throw new Error('Output to src dir denied!')
		}
		if((/\.(js|css|html|htm)$/).test(input.toLowerCase())) {
			if(info.i18n && langResource) {
				var langCode
				for(var i = 0; i < langResource.LANG_LIST.length; i++) {
					var m = input.match(new RegExp('\\/(' + langResource.LANG_LIST[i] + ')\\/'))
					if(m) {
						langCode = m[1];
						break;
					}
				}
				if(langCode) {
					writeFileSync(output, lang.replaceProperties(fs.readFileSync(input, charset), langResource[langCode]), charset)
				} else {
					grunt.file.copy(input, output, {encoding: charset})
				}
			} else {
				grunt.file.copy(input, output, {encoding: charset})
			}
		} else {
			grunt.file.copy(input, output, {encoding: null})
		}
		log('Done!')
		callback()
	}
	function copy() {
		var fileName, inputFile, outputFile
		if(copyList.length) {
			fileName = copyList.shift()
			inputFile = path.resolve(input, fileName)
			outputFile = path.resolve(output, path.basename(inputFile))
			if(includeRegexp && !new RegExp(includeRegexp).test(fileName) && !fs.statSync(inputFile).isDirectory() || excludeRegexp && new RegExp(excludeRegexp).test(getUnixStylePath(inputFile)) || inputFile == output || path.relative(output, inputFile).indexOf('..') != 0 || path.relative(inputFile, output).indexOf('..') != 0) {
				copy()
			} else {
				copyOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					copy()
				}, true)
			}
		} else {
			callback()
		}
	}
}

function init(options, callback) {
	var argProperties = grunt.option('yomb-properties')
	if(argProperties) {
		argProperties = JSON.parse(argProperties)
	}
	properties = utils.extendObject(options.properties, argProperties)
	outputBasePath = utils.getDefinedItem([grunt.option('yomb-output-base-path'), options.outputBasePath, outputBasePath])
	coffeeOptions = utils.getDefinedItem([options.coffeeOptions, coffeeOptions])
	globalProtect = utils.getDefinedItem([grunt.option('yomb-protect'), options.protect, globalProtect])
	globalAllowSrcOutput = utils.getDefinedItem([grunt.option('yomb-allow-src-output'), options.allowSrcOutput, globalAllowSrcOutput])
	globalUglifyLevel = utils.getDefinedItem([grunt.option('yomb-uglify'), options.uglify, globalUglifyLevel])
	globalBuildTpl = utils.getDefinedItem([grunt.option('yomb-build-tpl'), options.buildTpl, globalBuildTpl])
	globalBuildNodeTpl = utils.getDefinedItem([grunt.option('yomb-build-node-tpl'), options.buildNodeTpl, globalBuildNodeTpl])
	globalCssmin = utils.getDefinedItem([grunt.option('yomb-cssmin'), options.cssmin], globalCssmin)
	globalCompressHtml = utils.getDefinedItem([grunt.option('yomb-compress-html'), options.compressHtml, globalCompressHtml])
	globalCompressHtmlOptions = utils.getDefinedItem([grunt.option('yomb-compress-html-options'), options.compressHtmlOptions, globalCompressHtmlOptions])
	globalExclude = utils.getDefinedItem([utils.getHashFromString(grunt.option('yomb-exclude')) || undefined, options.exclude, globalExclude])
	globalBanner = options.banner || globalBanner
	logs = []
	startTime = new Date()
	if(options.lang) {
		lang.getLangResource(path.resolve(buildDir, options.lang.base), function(res) {
			langResource = res
			callback()
		})
	} else {
		callback()
	}
	init = function(options, callback) {
		logs = []
		startTime = new Date()
		callback()
	}
}

module.exports = function(grunt) {
	grunt.registerMultiTask('yomb', 'YOM builder tasks.', function() {
		var self = this
		var coffeeList, buildList, combineList, copyList
		var options = this.options({})
		var targetType = this.target.split('-')[0]
		init(options, function() {
			printLine('+')
			if(targetType === 'coffee') {
				log('Started at ' + grunt.template.today('yyyy-mm-dd HH:MM:ss'), 0, true)
				done = self.async()
				coffeeList = self.files || []
				compileCoffee()
			} else if(targetType === 'build') {
				log('Started at ' + grunt.template.today('yyyy-mm-dd HH:MM:ss'), 0, true)
				done = self.async()
				buildList = self.files || []
				build()
			} else if(targetType === 'concat') {
				log('Started at ' + grunt.template.today('yyyy-mm-dd HH:MM:ss'), 0, true)
				done = self.async()
				combineList = self.files || []
				combine()
			} else if(targetType === 'copy') {
				log('Started at ' + grunt.template.today('yyyy-mm-dd HH:MM:ss'), 0, true)
				done = self.async()
				copyList = self.files || []
				copy()
			}
		})

		function compileCoffee() {
			var file, input, output
			if(coffeeList.length) {
				file = coffeeList.shift()
				if(file.src.length > 1) {
					output = file.dest
					if(output) {
						compileOneCoffee(utils.extendObject(file, {inputs: file.src, output: output}, false, 0), function() {
							compileCoffee()
						})
					} else {
						compileCoffee()
					}
				} else if(file.src[0]) {
					input = file.src[0]
					output = file.dest
					if(path.extname(input).toLowerCase() == '.coffee' && output && !path.extname(output)) {
						output = path.join(output, input)
					}
					if(fs.statSync(input).isDirectory()) {
						compileDirCoffee(utils.extendObject(file, {input: input, output: output}, false, 0), function() {
							compileCoffee()
						})
					} else {
						compileOneCoffee(utils.extendObject(file, {inputs: [input], output: output}, false, 0), function() {
							compileCoffee()
						})
					}
				} else {
					compileCoffee()
				}
			} else {
				exit(0)
			}
		}

		function build() {
			var file, input, output
			if(buildList.length) {
				file = buildList.shift()
				if(file.src.length > 1) {
					output = file.dest
					if(!path.extname(output)) {
						;(function buildSrc() {
							if(file.src.length > 0) {
								input = file.src.shift()
								if(path.extname(input)) {
									buildOne(utils.extendObject(file, {input: input, output: path.join(output, input)}, false, 0), function() {
										buildSrc()
									})
								} else {
									buildSrc()
								}
							} else {
								build()
							}
						})()
					} else {
						build()
					}
				} else if(file.src[0]) {
					input = file.src[0]
					output = file.dest
					if(path.extname(input) && output && !path.extname(output)) {
						output = path.join(output, input)
					}
					if(fs.statSync(input).isDirectory()) {
						buildOneDir(utils.extendObject(file, {input: input, output: output}, false, 0), function() {
							build()
						})
					} else {
						buildOne(utils.extendObject(file, {input: input, output: output}, false, 0), function() {
							build()
						})
					}
				} else {
					build()
				}
			} else {
				exit(0)
			}
		}

		function combine() {
			if(combineList.length) {
				combineOne(combineList.shift(), function() {
					combine()
				})
			} else {
				exit(0)
			}
		}

		function copy() {
			var file, input, output
			if(copyList.length) {
				file = copyList.shift()
				if(file.src.length > 1) {
					output = file.dest
					if(!path.extname(output)) {
						;(function copySrc() {
							if(file.src.length > 0) {
								input = file.src.shift()
								if(path.extname(input)) {
									copyOne(utils.extendObject(file, {input: input, output: path.join(output, input)}, false, 0), function() {
										copySrc()
									})
								} else {
									copySrc()
								}
							} else {
								copy()
							}
						})()
					} else {
						copy()
					}
				} else if(file.src[0]) {
					input = file.src[0]
					output = file.dest
					if(path.extname(input) && !path.extname(output)) {
						output = path.join(output, input)
					}
					copyOne(utils.extendObject(file, {input: input, output: output}, false, 0), function() {
						copy()
					})
				} else {
					copy()
				}
			} else {
				exit(0)
			}
		}
	})
}
