# YOM Builder
YOM builder is a tool for packaging AMD modules, compiling micro templates and optimizing html files.

## Installation
Firstly you need to install [nodejs](http://nodejs.org/) and [npm](https://www.npmjs.org/), then install [grunt](http://gruntjs.com/) with command `npm install -g grunt` as we use grunt to run yomb tasks. At last use command `npm install grunt-yomb --save-dev` to install our builder.

## Conventions
Too many configarations bring in complexity and is hard to maintain, so we make some conventions to ease our work.  
*We use "(example)" or "(dist, src)" to show an example. "src" links to source files, and "dist" links to built result files.*  
- JS file of which name is "main" or end with "-main", "\_main", ".main" is the target building file. For example, "main.js", "index-main.js", "index\_main.js" and "index.main.js" are target building files ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/simple), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/simple)). 
- Dependancy module with relative path will be packaged with target building file. This process is recursive, which means if "main" requires "./foo", and "./foo" requires "./bar", then "main", "./foo" and "./bar" will be packaged together.
`var foo = require('./foo');`  
`var bar = require('../bar');`  
`var vender = require('vender');`  
foo and bar will be packaged with target building file ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/package-dependancy), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/package-dependancy)).  
If the output file is in the same folder, the output file names are "main-built.js", "index-main-built.js", "index_main_built.js" and "index.main.built.js" in order not to overwrite the orignal files, or else the output file name is the same as the target building file ([example](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/same-folder-output)). 
- Html file of which name is end with '.tpl' is micro template file. This file will be built into AMD module file. For example, you have a file named "cargo-list.tpl.html", and you can require it as below.  
`var cargoListTmpl = require('./cargo-list.tpl.html');`  
Then you can use it as below.  
`$('cargo-list').innerHTML = cargoListTmpl.render(data);`  
As JS file, html file of which name is "main.tpl" or end with "-main.tpl", "\_main.tpl", ".main.tpl" will be built into AMD module file. For example, "foo-main.tpl.html" will be built into "foo-main.tpl.html.js" ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/compile-template), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/compile-template)).
- less file of which name is "main" or end with "-main", "\_main", ".main" will be built into css file. For example, "foo-main.less" will be built into "foo-main.css" ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/compile-less), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/compile-less)). 

### Require AMD modules in template
As templates will be built into AMD modules, they can also require other AMD modules.
```javascript
<%
var $ = require('jquery');
var fooTpl = require('./foo.tpl.html');
%>
<%=fooTpl.render($data)%>
```

### Write AMD module like nodejs module
You can write your client AMD module like writing a nodejs module, yomb will build it into a formalized AMD module. You must assign your module implementation to `module.exports` ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/write-like-nodejs), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/write-like-nodejs)).
```javascript
var $ = require('jquery');
var foo = {};
foo.bar = function() {
  alert('hello world');
};
module.exports = foo;
```
will be built into
```javascript
define(['require', 'exports', 'module', 'jquery'], function(require, exports, module) {
  var $ = require('jquery');
  var foo = {};
  foo.bar = function() {
    alert('hello world');
  };
  module.exports = foo;
});
```

### Use variables in requiring module name
```javascript
var langFoo = require('lang/{{G.LANG}}/foo');
var foo = {};
foo.bar = function() {
  alert(langFoo.hello);
};
module.exports = foo;
```
will be built into
```javascript
define(['require', 'exports', 'module', 'lang/' + G.LANG + '/foo'], function(require, exports, module) {
  var langFoo = require('lang/' + G.LANG + '/foo');
  var foo = {};
  foo.bar = function() {
    alert(langFoo.hello);
  };
  module.exports = foo;
});
```

## Usage
Firstly you need to create a *Gruntfile.js* file ([example](https://github.com/webyom/grunt-yomb-example/blob/master/Gruntfile.js)) in the root filder of your project. Then add a "yomb" task in grunt file, then add some targets in yomb task. The name of a target should be start with "coffee-",  "build-", "concat-" or "copy-". You can run yomb task with command `grunt yomb`.
- `coffee-` : compile coffeescript file into javascript file ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/compile-coffee), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/compile-coffee)).
- `build-` : build AMD module, micro template or html source file.
- `concat-` : concat one or multiple files into one file.
- `copy-` : copy files.
YOM builder is built on NodeJS. You can run it in command line like this:  
`node path/to/builder.js`
In "coffee-" and "build-" targets, you can set "ignore" property to ignore some folders or files.
```javascript
'coffee-all': {
  files: [
    {
      src: 'src',
      ignore: {
        'node_modules': 1
      }
    }
  ]
},
'build-all': {
  files: [
    {
      src: 'src',
      dest: 'dist',
      ignore: {
        'node_modules': 1,
        'script/vender/jquery/jquery.js': 1
      }
    }
  ]
},
```

## Command line options
- `--config-file filepath` : In general builder does't need config file to work,  It does traversal building in current working directory according to the rules. However, you can specify a config file to use advanced setting.
- `--uglify N` : YOM builder use uglifyJS to compress JS code. N stands for compress level, default is 0.  
-1: beautify  
0 : do nothing  
1 : uglify  
2 : mangle  
3 : squeeze
- `--cssmin` : YOM builder use cssmin to compress CSS code. Pass this if you want to compress CSS file.
- `--compressHtml` : YOM builder use google htmlcompressor to compress HTML code. Pass this if you want to compress HTML file.
- `--compress-html-options` : Options passed to htmlcompressor.
- `--build-node-tpl` : Pass this if you want to build micro template file into nodeJS module file.
- `--exclude filelist` : Relative file path list delimited by comma. Used to exclude files built with target building file.
- `--output-base-path` : If this was specified, all the output path will be joined with thie base path.

## yomb task options
- `uglify` : Same as uglify option in command line.  
eg. `{"uglify": -1}`
- `cssmin` : Same as cssmin option in command line.  
eg. `{"cssmin": true}`
- `compressHtml` : Same as compress-html option in command line.  
eg. `{"compressHtml": true}`
- `outputBasePath` : Same as output-base-path option in command line.  
eg. `{"outputBasePath": "../static}`
- `buildNodeTpl` : Same as build-node-tpl option in command line.  
eg. `{"buildNodeTpl": true}`
- `exclude` : Same as exclude option in command line, and has higher priority, but is a hash object.  
eg. `{"exclude" : {"./mod1": 1, "../mod2": 1}}`
- `copyright` : JS copyright text.  
eg. `{"copyright": "/* All rights reserved */"}`
- `properties` : This option defines reusable values.  
eg. `{"properties": {"a": {"b": {"c": 1}}}}`  
Defined values can be used as `%{{a.b.c}}%` in html source file and template.  
"\_lang\_" is a special property, it is the language code being processed. You can use `%{{_lang_}}%` in html source file to include language resource file.  
eg. `<!-- include "lang/%{{_lang_}}%/foo.js" -->`  
- `lang` : Multiple language support.
    - `base` : The path where language resource files placed. Language resource file should be AMD module file.  
    eg. `{"lang": {"base": "./js/lang"}}`

## Optimize html file
YOM builder can build external JS and CSS file into Html file, in order to enhance the page performance by reducing http request amount. Html file of which name is end with ".src" is considerred the source file to be optimized, and the optimized result file will be output to the output folder with the name without ".src". Micro template file can also be optimized in this way. Below are instructions of optimization. Html file of which name is end with ".inc" is reusable html segment file, which can be included in the source file ([dist](https://github.com/webyom/grunt-yomb-example/blob/master/dist/examples/html-optimization), [src](https://github.com/webyom/grunt-yomb-example/blob/master/src/examples/html-optimization)).
- `include` : Include an external file into the Html source file, the included file can also be Html source file, and the optimization is done recursively.  
eg. `<!-- include "./mod1.js" -->`, `<!-- include "./segment.inc.html" -->`  
You can even specify a plain-id to the instruction, in order to make the JS code not execuded immediately, and execude it on demand.  
eg. `<!-- include "./mod1.js" plain-id:mod1-script -->`  
The output will be `<script type="text/plain" id="mod1-script">...`
You can also use include in template file to mixin another template.  
eg. `<!-- include "./foo.tpl.html" -->`  
- `require` : Require is an instruction for building AMD module into Html source file. It also supports plain-id.  
eg. `<!-- require "./mod1" -->`
- `uglify` : Uglify JS code built into Html source file.  
eg. `<!-- uglify -1 -->`
- `cssmin` : Compress CSS code built into Html source file.  
eg. `<!-- cssmin true -->`

### Use language resource in html source file
Language resource can be used as `${{a.b.c}}$` in html source file
If you have a language resource file "lang/en/foo.js" as below.
```javascript
define({
  label: {
    bar: 'Bar'
  } 
});
```
You can use `${{foo.label.bar}}$` in html source file.

## Examples
https://github.com/webyom/grunt-yomb-example
