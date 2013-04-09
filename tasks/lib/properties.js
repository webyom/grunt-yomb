/**
 * Properties replacer
 * Copyright (c) 2012 Gary Wang, webyom@gmail.com http://webyom.org
 * Under the MIT license
 * https://github.com/webyom/yom
 */

function getTimestamp(divisor) {
	divisor = parseInt(divisor) || 1000
	return parseInt(new Date() / divisor)
}

function getProperty(propName, properties) {
	var tmp, res
	if((/^TIMESTAMP(_\d+|$)/).test(propName)) {
		return getTimestamp(propName.split('_')[1])
	} else {
		tmp = propName.split('.')
		res = properties
		while(tmp.length && res) {
			res = res[tmp.shift()]
		}
		return res
	}
}

exports.replaceProperties = function(content, properties) {
	if(!properties) {
		return content
	}
	return content.replace(/%{{([\w-\.]+)}}%/g, function(full, propName) {
		var res = getProperty(propName, properties)
		return typeof res == 'string' ? res : full
	})
}