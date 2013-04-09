/*
 * grunt-yomb
 * https://github.com/webyom/yomb.git
 *
 * Copyright (c) 2013 Gary Wang
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

  // Project configuration.
  grunt.initConfig({
    jshint: {
      all: [
        'Gruntfile.js',
        'tasks/*.js',
        '<%= nodeunit.tests %>',
      ],
      options: {
        jshintrc: '.jshintrc',
      },
    },

    // Before generating any new files, remove any previously-created files.
    clean: {
      tests: ['tmp'],
    },

    // Configuration to be run (and then tested).
    yomb: {
      options: {
        uglify: 0,
        compressHtml: false,
        cssmin: false,
        lang: {
          base: './data/src/js/lang'
        },
        properties: {
          cssmin: 'false',
          config: {
            domain: 'document.domain',
            origin: 'location.protocol + "//" + location.host',
            cgiOrigin: 'location.protocol + "//" + location.host',
            cgiBase: "static/mockup-data/"
          },
          pageAside: '3',
          itemsPerPage: '10',
          mandatory: '<span style=\"color: red;\">*</span>'
        }
      },

      'build-all': {
        files: [
          {
            src: 'data/src',
            dest: 'data/dest',
            ignore: {
              'html/inc': 1,
              'js/inc': 1,
              'index.src.html': 1,
              'js/lib/rfl/history-blank.src.html': 1,
              'js/lib/rfl/local-storage-proxy.src.html': 1,
              'js/lib/jquery': 1,
              'js/lib/jquery-ui': 1
            }
          },
          {
            src: 'data/src/js/lib/jquery',
            dest: 'data/dest/js/lib/jquery',
            banner: '/*! jQuery v1.9.1 jquery.com | jquery.org/license */\n'
          },
          {
            src: 'data/src/index.src.html',
            dest: 'data/dest/index.html'
          },
          {
            src: 'data/src/js/lib/rfl/history-blank.src.html',
            dest: 'data/dest/js/lib/rfl/history-blank.html'
          },
          {
            src: 'data/src/js/lib/rfl/local-storage-proxy.src.html',
            dest: 'data/dest/js/lib/rfl/local-storage-proxy.html'
          }
        ]
      },

      'concat-all': {
        files: [
          {
            src: [
              'data/src/js/lib/bootstrap/js/bootstrap-transition.js',
              'data/src/js/lib/bootstrap/js/bootstrap-modal.js',
              'data/src/js/lib/bootstrap/js/bootstrap-dropdown.js',
              'data/src/js/lib/bootstrap/js/bootstrap-scrollspy.js',
              'data/src/js/lib/bootstrap/js/bootstrap-tab.js',
              'data/src/js/lib/bootstrap/js/bootstrap-tooltip.js',
              'data/src/js/lib/bootstrap/js/bootstrap-popover.js',
              'data/src/js/lib/bootstrap/js/bootstrap-affix.js',
              'data/src/js/lib/bootstrap/js/bootstrap-alert.js',
              'data/src/js/lib/bootstrap/js/bootstrap-button.js',
              'data/src/js/lib/bootstrap/js/bootstrap-collapse.js',
              'data/src/js/lib/bootstrap/js/bootstrap-carousel.js',
              'data/src/js/lib/bootstrap/js/bootstrap-typeahead.js'
            ],
            dest: 'data/dest/js/lib/bootstrap/bootstrap-main-built.js',
            banner: '/* Copyright 2012 Twitter, Inc. | http://www.apache.org/licenses/LICENSE-2.0 */\n'
          }
        ]
      },

      'copy-all': {
        files: [
          {
            src: 'data/src/js/lang',
            dest: 'data/dest/js/lang'
          },
          {
            src: 'data/src/mockup-data',
            dest: 'data/dest/mockup-data',
            condition: 'property: config.cgiBase == "static/mockup-data/"'
          },
          {
            src: 'data/src',
            dest: 'data/dest',
            regexp: '(\\.jpg|\\.jpeg|\\.gif|\\.png|\\.ico|-min\\.css)$'
          }
        ]
      }
    },

    // Unit tests.
    nodeunit: {
      tests: ['test/*_test.js'],
    },

  });

  // Actually load this plugin's task(s).
  grunt.loadTasks('tasks');

  // These plugins provide necessary tasks.
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-nodeunit');

  // Whenever the "test" task is run, first clean the "tmp" dir, then run this
  // plugin's task(s), then test the result.
  grunt.registerTask('test', ['jshint', 'clean', 'yomb', 'nodeunit']);

  // By default, lint and run all tests.
  grunt.registerTask('default', ['yomb']);

};
