/**
 * Command line args getter
 * Copyright (c) 2012 Gary Wang, webyom@gmail.com http://webyom.org
 * Under the MIT license
 * https://github.com/webyom/yom
 */

function isArgName(str) {
	return (/^-/).test(str) && !(/^-+\d/).test(str)
}

exports.get = function() {
	var args = {}
	var argv = Array.prototype.slice.call(process.argv)
	var i = 2
	for(; i < argv.length;) {
		if(!argv[i]) {
			break
		}
		if(isArgName(argv[i])) {
			if(!argv[i + 1] || isArgName(argv[i + 1])) {
				args[argv[i].replace(/^-+/, '')] = true
				i++
			} else {
				args[argv[i].replace(/^-+/, '')] = argv[i + 1]
				i += 2
			}
		} else {
			i++
		}
	}
	return args
}
