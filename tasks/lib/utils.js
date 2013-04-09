/**
 * Utils
 * Copyright (c) 2012 Gary Wang, webyom@gmail.com http://webyom.org
 * Under the MIT license
 * https://github.com/webyom/yom
 */
 
function arrayEach(arr, callback) {
	for(var i = 0, l = arr.length; i < l; i++) {
		callback(arr[i], i, arr)
	}
}

function extendObject(origin, extend, check, deepLevel) {
	origin = origin || {}
	deepLevel = deepLevel || 3
	for(var p in extend) {
		if(Object.prototype.hasOwnProperty.call(extend, p) && (!check || typeof origin[p] == 'undefined')) {
			if(origin[p] && typeof origin[p] == 'object' && typeof extend[p] == 'object' && deepLevel > 0) {
				origin[p] = extendObject(origin[p], extend[p], check, deepLevel - 1)
			} else {
				origin[p] = extend[p]
			}
		}
	}
	return origin
}

function cloneObject(obj, deep, _level) {
	var res = obj
	deep = deep || 0
	_level = _level || 0
	if(_level > deep) {
		return res
	}
	if(typeof obj == 'object' && obj) {
		if(Array.isArray(obj)) {
			res = []
			arrayEach(obj, function(item) {
				res.push(item)
			})
		} else {
			res = {}
			for(var p in obj) {
				if(Object.prototype.hasOwnProperty.call(obj, p)) {
					res[p] = deep ? cloneObject(obj[p], deep, ++_level) : obj[p]
				}
			}
		}
	}
	return res
}

function getHashFromString(str, val) {
	var res = {}
	if(!str) {
		return null
	}
	str = str.split(/\s*,\s*/)
	for(var i = 0; i < str.length; i++) {
		res[str[i]] = typeof val != 'undefined' ? val : 1
	}
	return res
}

function getDefinedItem(list) {
	var i, res
	for(i = 0; i < list.length; i++) {
		res = list[i]
		if(typeof res != 'undefined') {
			return res
		}
	}
	return res
}

exports.extendObject = extendObject
exports.cloneObject = cloneObject
exports.getHashFromString = getHashFromString
exports.getDefinedItem = getDefinedItem
