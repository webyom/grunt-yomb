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
var utils = require('./lib/utils')
var lang = require('./lib/lang')
var replaceProperties = require('./lib/properties').replaceProperties

process.on('uncaughtException', function(err) {
	try {
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
		grunt.log.writeln(content)
	}
}

function dealErr(err) {
	var content = err.toString()
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

function writeFileSync(toPath, content, encoding, lang) {
	var pathProtected = false
	var i, protectedPath
	if(globalProtect) {
		if(typeof globalProtect == 'string') {
			protectedPath = path.resolve(buildDir, globalProtect)
			pathProtected = isPathProtected(toPath, protectedPath)
		} else if(Array.isArray(globalProtect)) {
			for(i = 0; i < globalProtect; i++) {
				protectedPath = path.resolve(buildDir, globalProtect[i])
				pathProtected = isPathProtected(toPath, protectedPath)
				if(pathProtected) {
					break;
				}
			}
		}
	}
	if(pathProtected) {
		log('Warning: "' + protectedPath + '" is protected!')
		return
	}
	if(properties && charset) {
		properties._lang_ = lang || undefined
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
	ast = uglify.parse(content)
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
	def.replace(/(?:^|[^\.\/\w])require\s*\(\s*(["'])([^"']+?)\1\s*\)/mg, function(full, quote, dep) {
		got[dep] || deps.push(dep)
		got[dep] = 1
	})
	return deps
}

function getRelativeDeps(def, exclude) {
	var deps = []
	var got = {}
	var depArr = def.match(/(?:^|[^\.\/\w])define\s*\([^\[\{]*(\[[^\[\]]*\])/m)
	depArr = depArr && depArr[1]
	exclude = exclude || {}
	depArr && depArr.replace(/(["'])(\.[^"']+?)\1/mg, function(full, quote, dep) {
		got[dep] || exclude[dep] || globalExclude[dep] || (/(-built|\.js)$/).test(dep) || deps.push(dep)
		got[dep] = 1
	})
	def.replace(/(?:^|[^\.\/\w])require\s*\(\s*(["'])(\.[^"']+?)\1\s*\)/mg, function(full, quote, dep) {
		got[dep] || exclude[dep] || globalExclude[dep] || (/(-built|\.js)$/).test(dep) || deps.push(dep)
		got[dep] = 1
	})
	return deps
}

function traversalGetRelativeDeps(inputDir, def, exclude, processed, curDir) {
	var deps = getRelativeDeps(def, exclude)
	var res = []
	var depId, fileName
	processed = processed || {}
	curDir = curDir || inputDir
	while(deps.length) {
		depId = path.join(path.relative(inputDir, curDir), deps.shift()).split(path.sep).join('/')
		if(!(/^\./).test(depId)) {
			depId = './' + depId
		}
		if(processed[depId]) {
			continue
		} else {
			res.push(depId)
			processed[depId] = 1
		}
		if(!(/\.tpl\.html?$/).test(depId)) {
			fileName = path.resolve(curDir, depId + '.js')
			def = fs.readFileSync(fileName, charset)
			res = traversalGetRelativeDeps(inputDir, def, exclude, processed, path.dirname(fileName)).concat(res)
		}
	}
	return res
}

function getTmplObjName(str) {
	var tmplObjName = (str + '').replace(/(?:[-_\.]+|(?:\.*\/)+)(\w)([^-_\.\/]*)/g, function($0, $1, $2) {return $1.toUpperCase() + $2})
	tmplObjName = tmplObjName.charAt(0).toLowerCase() + tmplObjName.slice(1)
	return tmplObjName
}

function getIncProcessed(input, info, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var inputDir = path.dirname(input)
	var outputDir = opt.outputDir || inputDir
	var tmpl = opt.tmpl || fs.readFileSync(input, charset)
	var compressCss = typeof info.cssmin != 'undefined' ? info.cssmin : globalCssmin
	var reverseDepMap = utils.cloneObject(opt.reverseDepMap) || {}
	var baseUrl, ugl
	if(reverseDepMap[input]) {
		log('Warn: "' + input + '" have circular reference!')
		return ''
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
		var ug = isNaN(ugl) ? info.uglify : ugl
		file = path.join(inputDir, file)
		extName = path.extname(file)
		log('Merging: ' + file)
		if((/\.(src|inc|tpl)\.html?$/).test(file)) {
			res = getIncProcessed(file, info, {reverseDepMap: reverseDepMap, outputDir: outputDir})
		} else {
			res = fs.readFileSync(file, charset)
			if(extName == '.js') {
				res = [
					plainId ? '<script type="text/plain" id="' + plainId + '">' : '<script type="text/javascript">',
					getUglified(res, {uglify: ug}, {inline: true}),
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
		var file = path.join(inputDir, id).replace(/\.js$/, '') + '.js'
		var ug = isNaN(ugl) ? info.uglify : ugl
		id = getUnixStylePath(id.replace(/\.js$/, ''))
		log('Merging: ' + file)
		return [
			plainId ? '<script type="text/plain" id="' + plainId + '">' : '<script type="text/javascript">',
			getUglified([
				getBuiltAmdModContent(file, info, {id: id, reverseDepMap: reverseDepMap}),
				(/\brequire-plugin\b/).test(id) ? 'require.processDefQueue()' : 'require.processDefQueue(\'\', ' + (baseUrl || 'require.PAGE_BASE_URL') + ', require.getBaseUrlConfig(' + (baseUrl || 'require.PAGE_BASE_URL') + '))'
			].join(EOL), {uglify: ug}, {inline: true}),
			'</script>'
		].join(EOL)
	}).replace(/(<script\b[^>]*>)([^\f]*?)(<\/script>)/mg, function(full, startTag, content, endTag) {
		var eol, ug
		startTag = startTag.replace(/\s+data-uglify=(['"])(\d+)\1/, function(full, quote, val) {
			ug = parseInt(val)
			return ''
		})
		content = content.replace(/^\s+$/, '')
		eol = content ? EOL : ''
		if(opt.tmpl && ug !== 0) {
			//beautify micro template inline script
			content = uglify.parse(content).print_to_string({beautify: true})
		}
		if(isNaN(parseInt(ug))) {
			ug = isNaN(ugl) ? info.uglify : ugl
		}
		if(ug === 0) {
			eol = ''
		}
		return startTag + eol + getUglified(content, {uglify: ug}, {inline: true}) + eol + endTag
	})
	if(info.lang) {
		tmpl = lang.replaceProperties(tmpl, langResource[info.lang])
	}
	return tmpl.replace(/\r\n/g, '\n')
}

function compileTmpl(input, type, info, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var tmpl = fs.readFileSync(input, charset)
	var strict = (/\$data\b/).test(tmpl)
	var res = []
	tmpl = getIncProcessed(input, info, utils.extendObject(opt, {tmpl: tmpl}))
	tmpl = tmpl.replace(/<\/script>/ig, '</s<%=""%>cript>')
	if(type == 'NODE') {
		//do nothing
	} else if(type == 'AMD') {
		res.push([
			opt.id ? 
			"define('" + opt.id + "', ['require', 'exports', 'module'], function(require, exports, module) {" :
			"define(function(require, exports, module) {"
		].join(EOL))
	} else {
		res.push([
			"var " + getTmplObjName(opt.id) + " = (function() {",
			"	var exports = {}"
		].join(EOL))
	}
	res.push([
		"	function $encodeHtml(str) {",
		"		return (str + '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\x60/g, '&#96;').replace(/\x27/g, '&#39;').replace(/\x22/g, '&quot;')",
		"	}",
		"	exports.render = function($data, $opt) {",
		"		$data = $data || {}",
		"		var _$out_= []",
		"		var $print = function(str) {_$out_.push(str)}",
		"		" + (strict ? "" : "with($data) {"),
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
				.replace(/<%(<-)?/g, "')" + EOL + "		")
				.replace(/->(\w+)%>/g, EOL + "		$1.push('")
				.split("%>").join(EOL + "		_$out_.push('") + "')",
		"		" + (strict ? "" : "}"),
		"		return _$out_.join('')",
		"	}"
	].join(EOL))
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
	return uglify.parse(res.join(EOL)).print_to_string({beautify: true})
}

function fixDefineParams(def, depId, baseId) {
	var bodyDeps
	bodyDeps = getBodyDeps(def)
	def = def.replace(/\b(define\s*\()\s*(?:(["'])([^"'\s]+)\2\s*,\s*)?\s*(\[[^\[\]]*\])?/m, function(full, d, quote, definedId, deps) {
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
		return [d, id && ("'" + getUnixStylePath(id) + "', "), deps || "['require', 'exports', 'module'], "].join('')
	})
	return def
}

function buildOneDir(info, callback, baseName) {
	baseName = baseName || ''
	var inputDir = path.resolve(buildDir, info.input)
	var outputDir = typeof info.output == 'undefined' ? inputDir : path.resolve(buildDir, outputBasePath, info.output, baseName)
	var buildList = fs.readdirSync(inputDir)
	var buildTotal = buildList.length
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
			} else if(path.basename(inputFile) == 'main.js' || (/-main.js$/).test(inputFile) ||  path.basename(inputFile) == path.basename(inputDir) + '.js') {
				fileName = path.basename(inputFile).replace(/\.js$/, '-built.js')
				outputFile = path.join(outputDir, fileName)
				buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					build()
				}, true)
			} else if(path.basename(inputFile) == 'main.less' || (/-main.less$/).test(inputFile) ||  path.basename(inputFile) == path.basename(inputDir) + '.less') {
				fileName = path.basename(inputFile).replace(/\.less$/, '.css')
				outputFile = path.join(outputDir, fileName)
				buildOne(utils.extendObject(utils.cloneObject(info), {input: inputFile, output: outputFile}), function() {
					build()
				}, true)
			} else if(globalBuildTpl && (/\.tpl\.html?$/).test(inputFile)) {
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
			} else if(compressCss && path.extname(inputFile) == '.css' && !(/-min.css$/).test(inputFile)) {
				fileName = path.basename(inputFile).replace(/.css$/, '-min.css')
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

function getBuiltAmdModContent(input, info, opt) {
	input = path.resolve(input)
	opt = opt || {}
	var inputDir = path.dirname(input)
	var fileContent = []
	var depId, deps, fileName, content
	var reverseDepMap = utils.cloneObject(opt.reverseDepMap) || {}
	if(reverseDepMap[input]) {
		log('Warn: "' + input + '" have circular reference!')
		return ''
	}
	reverseDepMap[input] = 1
	content = fs.readFileSync(input, charset)
	deps = traversalGetRelativeDeps(inputDir, content, info.exclude)
	while(deps.length) {
		depId = deps.shift()
		if((/\.tpl\.html?$/).test(depId)) {
			fileName = path.resolve(inputDir, depId)
			if(reverseDepMap[fileName]) {
				log('Warn: "' + fileName + '" and "' + input + '" have circular reference!')
				continue
			}
			log('Merging: ' + fileName)
			fileContent.push(fixDefineParams(compileTmpl(fileName, 'AMD', info, {id: depId, reverseDepMap: reverseDepMap}), depId, opt.id))
		} else {
			fileName = path.resolve(inputDir, depId + '.js')
			if(reverseDepMap[fileName]) {
				log('Warn: "' + fileName + '" and "' + input + '" have circular reference!')
				continue
			}
			log('Merging: ' + fileName)
			fileContent.push(fixDefineParams(fs.readFileSync(fileName, charset), depId, opt.id))
		}
	}
	fileContent.push(fixDefineParams(content, opt.id))
	return fileContent.join(EOLEOL)
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
	var fileContent, nodeTplOutput
	if(fs.statSync(input).isDirectory()) {//build dir
		buildOneDir(info, callback)
		return
	}
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
		fileContent = getUglified(compileTmpl(input, 'AMD', info), info)
		log('Writing: ' + output)
		writeFileSync(output, fileContent, charset)
		if(buildNodeTpl) {
			log('Merging: ' + nodeTplOutput)
			fileContent = getUglified(compileTmpl(input, 'NODE', info), info)
			log('Writing: ' + nodeTplOutput)
			writeFileSync(nodeTplOutput, fileContent, charset)
		}
		log('Done!')
		callback()
	} else if((/\.src\.html?$/).test(input)) {
		log('Merging: ' + input)
		fileContent = getIncProcessed(input, info, {outputDir: outputDir})
		log('Writing: ' + output)
		writeFileSync(output, fileContent, charset, info.lang)
		if(compressHtml) {
			exec('java -jar ' + htmlCompressorPath + ' ' + compressHtmlOptions + ' ' + output, function(err, stdout, stderr) {
				if(err) {
					throw err
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
		fileContent = getUglified(getBuiltAmdModContent(input, info), info)
		log('Writing: ' + output)
		writeFileSync(output, fileContent, charset)
		log('Done!')
		callback()
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
				fileContent.push(compileTmpl(fileName, 'NONE_AMD', info, {id: depId}))
				combineNext()
			} else if(path.extname(fileName) == '.less' && path.extname(output) == '.css') {
				compileLess(fileName, function(css) {
					fileContent.push(css)
					combineNext()
				})
			} else {
				fileContent.push(fs.readFileSync(fileName, charset))
				combineNext()
			}
		} else {
			log('Writing: ' + output)
			if(path.extname(output) == '.js') {
				fileContent = getUglified(fileContent.join(EOLEOL), info)
			} else if(path.extname(output) == '.css' && compressCss) {
				fileContent = cssmin(fileContent.join(EOLEOL))
			} else {
				fileContent = fileContent.join(EOLEOL)
			}
			writeFileSync(output, fileContent, charset)
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
	var filterRegexp = info.regexp
	var input = path.resolve(buildDir, info.input)
	var output = path.resolve(buildDir, outputBasePath, info.output)
	var outputDir = path.dirname(output)
	var copyList, content
	if(input == output) {
		return
	}
	if(fs.statSync(input).isDirectory()) {
		if(_deep && fileName == 'node_modules') {
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
		if((/\.(js|css|html|htm)$/).test(input)) {
			grunt.file.copy(input, output, {encoding: charset})
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
			if(filterRegexp && !new RegExp(filterRegexp).test(fileName) && !fs.statSync(inputFile).isDirectory() || inputFile == output || path.relative(output, inputFile).indexOf('..') != 0 || path.relative(inputFile, output).indexOf('..') != 0) {
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
	grunt.registerMultiTask('yomb', 'Your task description goes here.', function() {
		var self = this
		var buildList, combineList, copyList
		var options = this.options({})
		var targetType = this.target.split('-')[0]
		init(options, function() {
			printLine('+')
			if(targetType === 'build') {
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
					if(path.extname(input) && !path.extname(output)) {
						output = path.join(output, input)
					}
					buildOne(utils.extendObject(file, {input: input, output: output}, false, 0), function() {
						build()
					})
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
