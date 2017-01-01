var http      = require('http');
var https     = require('https');
var fs        = require('fs');
var fs_extra  = require('fs-extra');
var path      = require('path');
var morton    = require('morton');
var zipFolder = require('./zip-folder');
var async     = require('async');
var DownloadableObject =  require('./downloadable_object').DownloadableObject;

var _max_threading = 5;

function DownloadPS2(json, output_folder, guid, parent_folder) {
	var json_url = json.CollectionUrl;
	
	DownloadPS2Metadata(output_folder, json, function() {
		DownloadPS2Data(output_folder, json_url, function() {
				console.log("Done downloading: " + guid);
				zipFolder(output_folder, path.join(parent_folder, guid + ".zip"), function(err) {
					if (err) {
						console.log('oh no!', err);
					} else {
						fs_extra.removeSync(output_folder);
						console.log("Done Zipping: " + guid);
					}
				});				
		});
	});
}

function ConvertAnnotations(in_annotations) {
	var out_annotations = in_annotations.map(function(a) {

		var visibilityPreset = {
			'Auto':   0,
			'All':    1,
			'One':    2,
			'Manual': 3
		};

		return {
			worldPoint:         a.Placement.WorldPoint,
			queryPoint:         a.Placement.QueryPoint,
			visibility:         a.Placement.Visibility,
			visibilityPreset:   visibilityPreset[a.Placement.VisibilityPreset],
			radius:             a.Placement.Radius,
			text:               a.Description,
			dbid:               a.AnnotationId.toString(),
			imgIndex:           a.Placement.ImageIndex,
			surfaceOrientation: a.Placement.Orientation
		};
	});
	return out_annotations;
}

function DownloadPS2AnnotionThumbnails(output_folder, in_annotations, onComplete) {
	if (in_annotations.length == 0) {
		onComplete();
	} else {
		fs_extra.mkdirsSync(path.join(output_folder, "thumbs", "annotation"));
		var dl_annotations = [];
		for (var i=0; i<in_annotations.length; ++i) {
			var dl_annotation = new DownloadableObject();
			var url = in_annotations[i].ThumbnailUrl;
			var filepath = path.join(output_folder, "thumbs", "annotation", url.split("thumbs/annotation/")[1]);
			fs_extra.mkdirsSync(path.dirname(filepath));
			dl_annotation.Init(filepath, url);
			dl_annotations.push(dl_annotation);
		}
		var q = async.queue(function(task, callback) {
			task.DownloadToFile(function() {
				task.Clear();
				callback(null, true);
			}, function() {
				callback("error", false);
			});
		}, 20);
		q.drain = function() {
			onComplete();
		};
		for (var i=0; i<dl_annotations.length; ++i) {
			q.push(dl_annotations[i]);
		}		
	}
}

function DownloadPS2Metadata(output_folder, json, onComplete) {
	var obj = {};
	obj.id = json.Id;
	obj.title = json.Name;
	obj.description = json.Description;
	obj.viewUrl = "http://photosynth.net/preview/view/" + json.Id;
	obj.annotations = [];
	
	var dl = new DownloadableObject();
	fs_extra.removeSync(path.join(output_folder, "metadata.json"));
	dl.Init(path.join(output_folder, "metadata.json"), "https://photosynth.net/rest/2014-08/media/"+json.Id+"/annotations");
	dl.DownloadToMemory(function() {
		var annotations = dl.ParseJson();
		obj.annotations = ConvertAnnotations(annotations);
		dl.file_content = JSON.stringify(obj);
		dl.SaveToDisk(function() {
			DownloadPS2AnnotionThumbnails(output_folder, annotations, onComplete);
		}, function(err) {
			console.log(err);
			DownloadPS2AnnotionThumbnails(output_folder, annotations, onComplete);
		});
	}, function() {
		dl.file_content = JSON.stringify(obj);
		dl.SaveToDisk(function() {
			onComplete();
		}, function(err) {
			console.log(err);
			onComplete();
		});
	});	
}

function DownloadPS2Data(output_folder, json_url, onComplete) {
	var root_url = json_url.replace("0.json", "");
	
	//0.json
	var dl = new DownloadableObject();
	dl.Init(path.join(output_folder, "0.json"), json_url);
	dl.DownloadToMemory(function() {
		var json = dl.ParseJson();
		
		fs_extra.mkdirsSync(path.join(output_folder, "undistorted"));
		fs_extra.mkdirsSync(path.join(output_folder, "thumbs", "default"));
		if (json.json_version == 2) {
			fs_extra.mkdirsSync(path.join(output_folder, "points"));
			fs_extra.mkdirsSync(path.join(output_folder, "geometry"));
		} else {
			fs_extra.mkdirsSync(path.join(output_folder, "ps1"));
		}
		
		for (var i=0; i<json.pyramid_levels; ++i) {
			fs_extra.mkdirsSync(path.join(output_folder, "l" + i));	
		}
		fs_extra.mkdirsSync(path.join(output_folder, "atlas"));		
		
		
		var dl_bins = [];
		
		// Path
		var dl_path = new DownloadableObject();
		dl_path.Init(path.join(output_folder, "path.bin"), root_url + "path.bin");
		dl_bins.push(dl_path);
		
		// Point cloud
		for (var i=0; i<json.num_point_files; ++i) {
			var bin_filepath = "";
			var bin_url = "";
			if (json.json_version == 2) {
				var bin_filename = "points_" + i + ".bin";
				bin_filepath = path.join(output_folder, "points", bin_filename);
				bin_url = root_url + "points/" + bin_filename;
			} else {
				var bin_filename = "points_0_" + i + ".bin";
				bin_filepath = path.join(output_folder, "ps1", bin_filename);
				bin_url = root_url + "ps1/" + bin_filename;
			}
			var dl_bin = new DownloadableObject();
			dl_bin.Init(bin_filepath, bin_url);
			dl_bins.push(dl_bin);
		}
		
		// Geometry files
		for (var i=0; i<json.geometry_ranges.length; ++i) {
			var bin_filename = "geometry_" + i + ".bin";
			var bin_filepath = "";
			var bin_url = "";			
			if (json.json_version == 2) {
				bin_filepath = path.join(output_folder, "geometry", bin_filename);
				bin_url = root_url + "geometry/" + bin_filename;
			} else {
				bin_filepath = path.join(output_folder, bin_filename);
				bin_url = root_url + bin_filename;
			}
			var dl_bin = new DownloadableObject();
			dl_bin.Init(bin_filepath, bin_url);
			dl_bins.push(dl_bin);
		}
		
		// Atlas files
		for (var i=0; i<json.num_atlases; ++i) {
			var bin_filename = "atlas_" + i + ".jpg";
			var bin_filepath = path.join(output_folder, "atlas", bin_filename);
			var bin_url = root_url + "atlas/" + bin_filename;
			var dl_bin = new DownloadableObject();
			dl_bin.Init(bin_filepath, bin_url);
			dl_bins.push(dl_bin);
		}
		
		// Thumbs files
		var thumb_files = ["share.mp4", "poster.jpg", "chip.color", "bg.jpg"];
		for (var i=0; i<20; ++i) {
			thumb_files.push(i + ".jpg");
		}
		for (var i=0; i<thumb_files.length; ++i) {
			var bin_filename = thumb_files[i];
			var bin_filepath = path.join(output_folder, "thumbs", "default", bin_filename);
			var bin_url = root_url + "thumbs/default/" + bin_filename;
			var dl_bin = new DownloadableObject();
			dl_bin.Init(bin_filepath, bin_url);
			dl_bins.push(dl_bin);
		}
		
		// Lod image files.		
		for (var i=0; i<json.cameras.length; ++i) {
			var camera = json.cameras[i];
			var camera_index = camera.index;			
			var filename_basename = GetImageBasename(camera_index);
			var filename =  filename_basename + ".jpg";
			var image_folder = path.join(output_folder, "undistorted", filename_basename);
			var image_root_url = root_url + "undistorted/" + filename_basename + "/";
			fs_extra.mkdirsSync(image_folder);
			for (var j=0; j<json.pyramid_levels; ++j) {
				var bin_filename = filename;
				var bin_filepath = path.join(output_folder, "l"+j, bin_filename);
				var bin_url = root_url + "l"+j+"/" + bin_filename;
				var dl_bin = new DownloadableObject();
				dl_bin.Init(bin_filepath, bin_url);
				dl_bins.push(dl_bin);
			}
			
			if (camera.original_size) {
				var tilesize = 512;
				var width = camera.original_size[0];
				var height = camera.original_size[1];
				var num_levels = GetPOT(Math.max(width, height));
				var num_columns = Math.ceil(width / tilesize);
				var num_rows = Math.ceil(height / tilesize);
				while (num_levels >= 0) {
					var current_level_folder = image_folder + "/" + num_levels;
					fs_extra.mkdirsSync(current_level_folder);
					for (var x=0; x<num_columns; ++x) {
						for (var y=0; y<num_rows; ++y) {
							var tile_filename = x + "_" + y + ".jpg";
							var tile_filepath = current_level_folder + "/" + tile_filename;
							var tile_url = image_root_url + "/" + num_levels + "/" + tile_filename;
							var dl_bin = new DownloadableObject();
							dl_bin.Init(tile_filepath, tile_url);
							dl_bins.push(dl_bin);
						}
					}
					width /= 2;
					height /= 2;
					num_columns = Math.ceil(width / tilesize);
					num_rows = Math.ceil(height / tilesize);
					num_levels--;
				}
			}			
		}
		
		// 0.json
		dl.SaveToDisk(function() {		
			var q = async.queue(function(task, callback) {
				task.DownloadToFile(function() {
					task.Clear();
					callback(null, true);
				}, function() {
					callback("error", false);
				});
			}, 20);
			q.drain = function() {
				onComplete();
			};
			for (var i=0; i<dl_bins.length; ++i) {
				q.push(dl_bins[i]);
			}
		});
	});
}

function GetImageBasename(index) {
	var padded_index = (index < 10) ? "000" + index : (index < 100) ? "00" + index : (index < 1000) ? "0" + index : index;
	return "img" + padded_index;
}

function GetPOT(value) {
	var pot = 0;
	var current_value = 1;
	do {
		pot++;
		current_value *=2;
	}
	while (current_value < value);

	return pot;	
}

module.exports = DownloadPS2;