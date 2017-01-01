"use strict";

var args     = process.argv.slice(2);
var fs_extra = require('fs-extra');
var path     = require('path');
var DownloadableObject = require('./downloadable_object').DownloadableObject;
var DownloadPS1 = require('./ps1_downloader');
var DownloadPS2 = require('./ps2_downloader');

// PS1: 1e509490-5657-453d-a2f6-2e55d14ae512
// PS2: 6d08dbf0-a0be-4185-9a5a-dec8bd45a4b3
// Pano mobile: 0e10e9d5-cf30-421e-9e13-9f8f8e04033a
// Pano ice: d724f8fa-f7a1-454f-809b-3d2f3a2976e7

function DownloadPanorama(json, output_folder, guid) {
	console.log("Panorama download is not supported yet");
}

if (args.length !== 2) {
	console.log("you need to provide guid of photosynth and output folder");
}
else {
	var guid = args[0];
	var parent_folder = args[1]
	console.log("Downloading photosynth: " + guid + " to " + parent_folder);
	
	var output_folder = path.join(parent_folder, guid);

	var dl = new DownloadableObject();
	dl.Init(path.join(output_folder, "properties.json"), "https://photosynth.net/rest/2014-08/media/" + guid);
	dl.DownloadToMemory(function() {
		fs_extra.mkdirsSync(output_folder);
		dl.SaveToDisk(function() {
			var json = dl.ParseJson();
			if (json.Panorama) {
				DownloadPanorama(json, output_folder, guid);
			} else if (json.Synth) {
				DownloadPS1(json, output_folder, guid, parent_folder);
			} else if (json.SynthPacket) {
				DownloadPS2(json, output_folder, guid, parent_folder);
			} else {				
				console.log(json);
				console.log("Un-recognize synth type :(");
			}
		});
	}, function() {
		console.log("Can't find photosynth: " + guid);
	});
}
