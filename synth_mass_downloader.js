"use strict";

var exec     = require('child_process').exec;
var fs       = require('fs');
var fs_extra = require('fs-extra');
var path     = require('path');
var async    = require('async');

// Usage: node synth_mass_downloader.js
// It will read _input_list_file and save all synths to _temp_folder and move them to _output_folder when completed (both folder need to exist).
// The input csv file can be generated with https://dddexperiments.github.io/photosynth/api-playground.html.
// -> Select File as output method (instead of Gallery default) and then select csv as output format and click download.
// You can also manually generate a csv file with only one guid per line and Unix line-ending.

// You can customize the following variables:
var _input_list_file = "dump.csv";
var _output_folder = "output";
var _temp_folder = "temp";
var _download_concurency = 1;
var _max_retry = 3;
var _retry_pause_duration = 10000; // 10s

// Read _input_list_file
var list_buffer = fs.readFileSync(_input_list_file);

// Parse _input_list_file using utf8 encoding and split the file into lines using Unix line-ending.
var guids = list_buffer.toString('utf8').split('\n');

// Remove empty line and first description line of dump.csv
guids = guids.filter(function(guid){ return guid != '' && guid != 'guid,title'; });

// Only keep the guid (get rid of synth name from dump.csv)
guids = guids.map(function(guid) { return guid.split(',')[0]; });

console.log(guids.length + " synths to download.");

var q = async.queue(function(guid, callback) {
	ProcessSynth(guid, callback);
}, _download_concurency);
q.drain = function() {
	console.log("Done");
};
for (var i=0; i<guids.length; ++i) {
	q.push(guids[i]);
}

function ProcessSynth(guid, callback) {
	var filepath = path.join(_output_folder, guid + ".zip");
	if (fs.existsSync(filepath)) {
		console.log("Skipping " + guid);
		callback();
	} else {
		var num_retry = _max_retry;
		DownloadSynth(guid, callback, num_retry);
	}
}

function DownloadSynth(guid, callback, num_retry) {
	console.log("Downloading synth " + guid);
	if (num_retry == 0) {
		// Stop re-trying and delete and re-create 'temp' folder.
		fs_extra.removeSync(path.join(_temp_folder, guid));
		fs_extra.mkdirsSync(path.join(_temp_folder, guid));
		callback();
		return;
	}
	
	var cmd = "node synth_downloader.js " + guid + " " + _temp_folder;
	exec(cmd, function (error, stdout, stderr) {
		if (stderr) {
			num_retry--;
			console.log("Fail Downloading " + guid + ", retry in 10s.");
			setTimeout(function() {
				DownloadSynth(guid, callback, num_retry);
			}, _retry_pause_duration);
		} else {
			// Move file from 'temp' to 'output'.
			fs_extra.copySync(path.join(_temp_folder, guid + ".zip"), path.join(_output_folder, guid + ".zip.tmp"), {overwrite: true});
			fs_extra.removeSync(path.join(_temp_folder, guid + ".zip"));
			fs_extra.removeSync(path.join(_output_folder, guid + ".zip"));
			fs.renameSync(path.join(_output_folder, guid + ".zip.tmp"), path.join(_output_folder, guid + ".zip"));
			callback();
		}
	});
}