"use strict";

var args     = process.argv.slice(2);
var async    = require('async');
var https    = require('https');
var fs       = require('fs');
var fs_extra = require('fs-extra');
var path     = require('path');
var DownloadableObject = require('./downloadable_object').DownloadableObject;
var DownloadPS1 = require('./ps1_downloader');
var DownloadPS2 = require('./ps2_downloader');
var DownloadPano = require('./pano_downloader');

// PS1: 1e509490-5657-453d-a2f6-2e55d14ae512
// PS2: 6d08dbf0-a0be-4185-9a5a-dec8bd45a4b3
// Pano mobile: 0e10e9d5-cf30-421e-9e13-9f8f8e04033a
// Pano ice: d724f8fa-f7a1-454f-809b-3d2f3a2976e7

var _rest_api_root_url = "https://photosynth.net/rest/2014-08/";

if (args.length !== 2) {
	console.log("you need to provide guid of photosynth and output folder");
}
else {
	var guid = args[0].toLowerCase();
	var parent_folder = args[1]
	console.log("Downloading photosynth: " + guid + " to " + parent_folder);
	
	var output_folder = path.join(parent_folder, guid);	
	fs_extra.mkdirsSync(output_folder);
	
	DownloadComments(guid, function(comments) {	
		console.log(comments.length + " comments downloaded.");
		var dl_comment = new DownloadableObject();
		dl_comment.Init(path.join(output_folder, "comments.json"), "");
		dl_comment.file_content = JSON.stringify(comments);
		dl_comment.SaveToDisk(function() {
			var dl = new DownloadableObject();
			dl.Init(path.join(output_folder, "properties.json"), _rest_api_root_url + "media/" + guid);
			dl.DownloadToMemory(function() {
				dl.SaveToDisk(function() {
					var json = dl.ParseJson();
					if (json.Panorama) {
						DownloadPano(json, output_folder, guid, parent_folder);
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
		});
	});
}

function DownloadComments(guid, onComplete) {
	function GetCommentUrl(guid, offset) {
		return _rest_api_root_url + "media/" + guid + "/comments?numRows="+_window+"&offset=" + offset;
	}
	
	function DownloadCommentsChunk(guid, offset, onComplete) {
		var chunks = "";
		https.get(GetCommentUrl(guid, offset), function(res) {
			if (res.statusCode == 404) {
				onComplete();
				return;
			}
			res.on('data', function(chunk) {
				chunks += chunk;
			});
			res.on('error', function() {
				onComplete();
			});
			res.on('end', function() {
				onComplete(JSON.parse(chunks));
			});
		});			
	}
	
	var _comments = [];
	var _window = 100;
	
	DownloadCommentsChunk(guid, 0, function(json) {
		if (json) {
			var num_total_comments = json.TotalResults;
			_comments = json.Comments;
			if (num_total_comments > _window) {
				var num_remaining_requests = Math.ceil(num_total_comments / _window) - 1;
				var offsets = [];
				for (var offset=_window; offset<=_window*num_remaining_requests; offset+=_window) {
					offsets.push(offset);
				}
				var q = async.queue(function(task, callback) {
					var offset = task;
					DownloadCommentsChunk(guid, offset, function(json) {
						if (json) {
							_comments = _comments.concat(json.Comments);
						}			
						callback();
					});
				}, 1);
				q.drain = function() {
					onComplete(_comments);
				};
				for (var i=0; i<offsets.length; ++i) {
					q.push(offsets[i]);
				}
			} else {
				onComplete(_comments);
			}
		} else {
			onComplete([]);
		}
	});
}