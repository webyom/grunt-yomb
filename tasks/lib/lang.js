/**
 * Multi-Language Support
 * Copyright (c) 2012 Gary Wang, webyom@gmail.com http://webyom.org
 * Under the MIT license
 * https://github.com/webyom/yom
 */

var fs = require('fs')
var path = require('path')
var langRegExp = /\${{([\w\-\.]+)}}\$/g

function getProperty(propName, properties) {
	var tmp, res
	tmp = propName.split('.')
	res = properties
	while(tmp.length && res) {
		res = res[tmp.shift()]
	}
	return res
}

exports.replaceProperties = function(content, properties, _lv) {
	_lv = _lv || 1
	if(!properties) {
		return content
	}
	return content.replace(langRegExp, function(full, propName) {
		var res = getProperty(propName, properties)
		if(typeof res != 'string') {
			res = '*' + propName + '*'
		} else if(langRegExp.test(res)) {
			if(_lv > 3) {
				res = '**' + propName + '**'
			} else {
				res = exports.replaceProperties(res, properties, _lv + 1)
			}
		}
		return res
	})
}

exports.getLangResource = (function() {
	var _LANG_CODE = {
		'en': 1, 'en-us': 1, 'zh-cn': 1, 'zh-hk': 1, 'zh-tw': 1
	}
	
	var charset = 'utf-8'
	
	function define() {
		var al = arguments.length
		if(al >= 3) {
			return arguments[2]
		} else {
			return arguments[al - 1]
		}
	}
	
	function require() {}
	
	function getResource(langPath, callback) {
		var res, fileList, file
		if(fs.statSync(langPath).isDirectory()) {
			res = {}
			fileList = fs.readdirSync(langPath)
			;(function getOne() {
				if(fileList.length) {
					file = path.resolve(langPath, fileList.shift())
					getResource(file, function(resource) {
						res[path.basename(file).replace(/\.js$/, '')] = resource
						getOne()
					})
				} else {
					callback(res)
				}
			})()
		} else if(path.extname(langPath) == '.js') {
			try {
				res = eval(fs.readFileSync(langPath, charset))
			} catch(e) {
				throw new Error('Language file "' + langPath + '" syntax error! - ' + e.toString())
			}
			if(typeof res == 'function') {
				res = res()
			}
			callback(res)
		} else {
			callback()
		}
	}
	
	return function getLangResource(dir, callback) {
		var res
		var langList = fs.readdirSync(dir)
		;(function getLang() {
			var langDir, langCode, fileList
			if(langList.length) {
				langDir = path.resolve(dir, langList.shift())
				langCode = path.basename(langDir)
				if(fs.statSync(langDir).isDirectory() && _LANG_CODE[langCode]) {
					res = res || {LANG_LIST: []}
					res.LANG_LIST.push(langCode)
					getResource(langDir, function(resource) {
						res[langCode] = resource
						getLang()
					})
				} else {
					getLang()
				}
			} else {
				callback(res)
			}
		})()
	}
})()