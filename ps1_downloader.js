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
var _debug_log = false;

/*
// Example for synth:
1e509490-5657-453d-a2f6-2e55d14ae512

// point cloud
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata.synth_files/0.json
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata.synth_files/points_0_0.bin
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata.synth_files/thumb.jpg

// seadragon collection
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata.dzc -> MaxLevel=?
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata_files/AppData/pscollection.bin
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata_files/0/0_0.jpg
https://cdn3.ps1.photosynth.net/synth/s01001300-ALQHJW1DeSM/metadata_files/5/0_0.jpg

// seadragon individual images
https://cdn3.ps1.photosynth.net/image/m01001300-ALQH7HNDeSM.dzi -> deduce MaxLevel from resolution.
https://cdn3.ps1.photosynth.net/image/m01001300-ALQH7HNDeSM_files/thumb.jpg
https://cdn3.ps1.photosynth.net/image/m01001300-ALQH7HNDeSM_files/0/0_0.jpg
https://cdn3.ps1.photosynth.net/image/m01001300-ALQH7HNDeSM_files/9/0_0.jpg
*/

function DownloadPS1(json, output_folder, guid, parent_folder) {
	fs_extra.mkdirsSync(path.join(output_folder, "images"));
	fs_extra.mkdirsSync(path.join(output_folder, "points"));
	
	var collection_url = json.CollectionUrl;
	var json_url = collection_url.replace("metadata.dzc", "metadata.synth_files/0.json");
	
	DownloadPS1SoapRequest(output_folder, guid, function() {
		DownloadPS1PointCloud(output_folder, json_url, function() {
			DownloadPS1Images(output_folder, collection_url, function() {
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
	});
}

function DownloadPS1SoapRequest(output_folder, guid, onComplete) {
	var dl = new DownloadableObject();
	dl.Init(path.join(output_folder, "soap.xml"), "");
	dl.PostSoapRequest(guid, function() {
		dl.SaveToDisk(function() {
			dl.ParseXml(function(result) {
				var json_url = result["soap:Envelope"]["soap:Body"][0].GetCollectionDataResponse[0].GetCollectionDataResult[0].JsonUrl[0];
				var json_filename = path.basename(json_url);
				var json_index = parseInt(json_filename.replace(".json", ""), 10);
				if (json_index > 0) {
					// We need to download all the intermediate json files.
					var dl_jsons = [];
					for (var i=1; i<=json_index; ++i) {
						var dl = new DownloadableObject();
						var curr_json_filename = i + ".json";
						var curr_json_url = json_url.replace(json_filename, curr_json_filename);
						var dl_json = new DownloadableObject();
						dl_json.Init(path.join(output_folder, curr_json_filename), curr_json_url);
						dl_jsons.push(dl_json);
					}
					
					var q = async.queue(function(task, callback) {
						task.DownloadToFile(function() {
							callback(null, true);
						}, function() {
							callback("error", false);
						});
					}, 2);
					q.drain = function() {
						onComplete();
					};
					for (var i=0; i<dl_jsons.length; ++i) {
						q.push(dl_jsons[i]);
					}
				} else {
					onComplete();
				}
			});
		});
	});
}

function DownloadPS1Images(output_folder, collection_url, onComplete) {
	fs_extra.mkdirsSync(path.join(output_folder, "collection"));
	fs_extra.mkdirsSync(path.join(output_folder, "collection", "AppData"));

	//metadata.dsc
	var dl = new DownloadableObject();	
	dl.Init(path.join(output_folder, "collection", "metadata.dsc"), collection_url);
	if (_debug_log) { console.log("Downloading: " + collection_url); }
	dl.DownloadToMemory(function() {
		dl.ParseXml(function(result) {
			var max_levels = parseInt(result.Collection.$.MaxLevel, 10);
			var items = result.Collection.Items[0].I;
			var dl_dzis = new Array();
			var dl_thumbs = new Array();
			var urls = [];
			for (var i=0; i<items.length; ++i) {
				var url = items[i].$.Source;
				if (url) {
					// It looks likes some synth lost their image data during big swap of storage backend.
					// ba12ab48-6899-4d7f-b28c-624f5f7ff4f0 was not working without this fix.
					urls.push(url);
				}
			};
			urls.map(function(url) {
				// url = http://cdn3.ps1.photosynth.net/image/m01001300-CbQHOnRDeSM.dzi
				// basename = m01001300-CbQHOnRDeSM.dzi
				// dirname = http://cdn3.ps1.photosynth.net/image/
				// image_guid = m01001300-CbQHOnRDeSM
				
				var image_guid = path.basename(url).replace(".dzi", "");
				var image_folder = path.join(output_folder, "images", image_guid);
				fs_extra.mkdirsSync(image_folder);
				var image_root_url = path.dirname(url) + "/" + image_guid + "_files";
				
				var dl_dzi = new DownloadableObject();
				dl_dzi.Init(path.join(image_folder, "0.dzi"), url);
				dl_dzis.push(dl_dzi);
				
				var dl_thumb = new DownloadableObject();
				dl_thumb.Init(path.join(image_folder, "thumb.jpg"), image_root_url + "/thumb.jpg");
				dl_thumbs.push(dl_thumb);
			});
			
			// global synth 100x100 thumb.jpg
			var dl_thumb = new DownloadableObject();
			dl_thumb.Init(path.join(output_folder, "thumb.jpg"), collection_url.replace("metadata.dzc", "metadata.synth_files/thumb.jpg"));
			dl_thumbs.push(dl_thumb);
			
			// collection/AppData/pscollection.bin
			var dl_pscollection = new DownloadableObject();
			dl_pscollection.Init(path.join(output_folder, "collection", "AppData", "pscollection.bin"), collection_url.replace("metadata.dzc", "metadata_files/AppData/pscollection.bin"));
			dl_thumbs.push(dl_pscollection);			
			
			if (_debug_log) { console.log("Downloading: " + urls.length + " images"); }
			
			dl.SaveToDisk(function() {
				var num_images = urls.length;
				DownloadPS1Collection(output_folder, max_levels, collection_url, num_images, function() {
					DownloadPS1BatchThumbs(dl_thumbs, function() {
						DownloadPS1BatchDzisToMemory(dl_dzis, function(dl_dzis) {
							DownloadPS1BatchImages(dl_dzis, function() {
								onComplete();
							})
						});
					});
				});
			}, function() {
				// onerror
			});
		}, function(err) {
			console.log(err);
		});
	});	
}

function DownloadPS1BatchThumbs(list, onComplete) {
	var q = async.queue(function(task, callback) {
		task.DownloadToFile(function() {
			task.Clear();
			callback(null, true);
		}, function() {
			task.Clear();
			console.log(task.url);
			callback("error", false);
		});
	}, _max_threading);
	q.drain = function() {
		onComplete();
	};
	for (var i=0; i<list.length; ++i) {
		q.push(list[i]);
	}
}
function DownloadPS1BatchDzisToMemory(list, onComplete) {
	var q = async.queue(function(task, callback) {
		task.DownloadToMemory(function() {
			callback(null, true);
		}, function() {
			callback("error", false);
		});
	}, _max_threading);
	q.drain = function() {
		onComplete(list);
	};
	for (var i=0; i<list.length; ++i) {
		q.push(list[i]);
	}
}

function DownloadPS1BatchImages(list, onComplete) {
	console.log("Downloading " + list.length + " images.");
	var q = async.queue(function(task, callback) {
		task.SaveToDisk(function() {
			DownloadSingleSeadragonImage(task, callback);
		}, function() {
			callback("error", false);
		});
	}, 2);
	q.drain = function() {
		onComplete(list);
	};
	for (var i=0; i<list.length; ++i) {
		q.push(list[i]);
	}
}

function Point2d(x, y) {
	this.x = x;
	this.y = y;
}

function DownloadPS1Collection(output_folder, max_levels, collection_url, num_images, onComplete) {
	var collection_root_url = collection_url.replace("metadata.dzc", "metadata_files/");
	
	function GetCurrentLevelFolder(output_folder, index) {
		return path.join(output_folder, "collection", ""+index /* hack itoa */);
	}
	
	// Creates one folder per layer.
	for (var i=0; i<=max_levels; ++i) {
		var current_level_folder = GetCurrentLevelFolder(output_folder, i);
		fs_extra.mkdirsSync(current_level_folder);
	}
	
	// Get all tiles of the finer layer (1 tile per image based on Morton Z-ordering).
	var current_level_folder = GetCurrentLevelFolder(output_folder, max_levels);
	var dl_tiles = [];
	var max_x = 0;
	var max_y = 0;
	
	for (var i=0; i<num_images; ++i) {
		var output = morton.reverse(i);
		var x = output[0];
		var y = output[1];
		
		max_x = Math.max(max_x, x);
		max_y = Math.max(max_y, y);
		
		var tile_filename = x + "_" + y + ".jpg";
		var tile_filepath = current_level_folder + "/" + tile_filename;
		var tile_url = collection_root_url + max_levels + "/" + tile_filename;
		
		var dl_tile = new DownloadableObject();
		dl_tile.Init(tile_filepath, tile_url);
		dl_tiles.push(dl_tile);
	}
	// increase by one as tile index start at 0.
	max_x++;
	max_y++;
	
	// Adding missing layers from fine to coarse.
	// Brute-force methods which will produce 404 urls but are filtered by the downloader.
	for (var i=max_levels-1; i>=0; i--) {
		current_level_folder = GetCurrentLevelFolder(output_folder, i);
		
		max_x = max_x / 2;
		max_y = max_y / 2;
		if (max_x < 1) { max_x = 1; }
		if (max_y < 1)  { max_y = 1; }
		
		for (var x=0; x<max_x; ++x) {
			for (var y=0; y<max_x; ++y) {
				var tile_filename = x + "_" + y + ".jpg";
				var tile_filepath = current_level_folder + "/" + tile_filename;
				var tile_url = collection_root_url + i + "/" + tile_filename;
				var dl_tile = new DownloadableObject();
				dl_tile.Init(tile_filepath, tile_url);
				dl_tiles.push(dl_tile);
			}
		}
	}
	
	var q = async.queue(function(task, callback) {
		task.SilentDownloadToFile(function() {
			callback(null, true);
		}, function() {
			callback("error", false);
		});
	}, _max_threading);
	q.drain = function() {
		onComplete();
	};
	for (var i=0; i<dl_tiles.length; ++i) {
		q.push(dl_tiles[i]);
	}
}

function DownloadSingleSeadragonImage(task, callback) {

	task.ParseXml(function(result) {

		var image_folder = task.filepath.replace("0.dzi", "");
		var image_root_url = task.url.replace(".dzi", "_files");
		var dl_tiles = [];
	
		var tilesize = result.Image.$.TileSize;
		var size = result.Image.Size[0].$;
		var width = size.Width;
		var height = size.Height;
		var num_columns = Math.ceil(width / tilesize);
		var num_rows = Math.ceil(height / tilesize);
		var num_levels = GetPOT(Math.max(width, height));
		while (num_levels >= 0) {
			var current_level_folder = image_folder + num_levels;
			fs_extra.mkdirsSync(current_level_folder);
			for (var x=0; x<num_columns; ++x) {
				for (var y=0; y<num_rows; ++y) {
					var tile_filename = x + "_" + y + ".jpg";
					var tile_filepath = current_level_folder + "/" + tile_filename;
					var tile_url = image_root_url + "/" + num_levels + "/" + tile_filename;
					var dl_tile = new DownloadableObject();
					dl_tile.Init(tile_filepath, tile_url);
					dl_tiles.push(dl_tile);
				}
			}
			width /= 2;
			height /= 2;
			num_columns = Math.ceil(width / tilesize);
			num_rows = Math.ceil(height / tilesize);
			num_levels--;
		}
		
		var q = async.queue(function(task, q_callback) {
			task.DownloadToFile(function() {
				task.Clear();
				q_callback(null, true);
			}, function() {
				q_callback("error", false);
			});
		}, 20);
		q.drain = function() {
			callback(null, true);
		};
		for (var i=0; i<dl_tiles.length; ++i) {
			q.push(dl_tiles[i]);
		}
	}, function() {
		callback("dzi parsing error", false);
	});	
}

function DownloadPS1PointCloud(output_folder, json_url, onComplete) {
	
	var root_url = json_url.replace("0.json", "");
	
	//0.json
	var dl = new DownloadableObject();
	dl.Init(path.join(output_folder, "0.json"), json_url);
	dl.DownloadToMemory(function() {
		var json = dl.ParseJson();
		var root;
		for (var guid in json["l"]) {
			root = json["l"][guid];
		}
		
		var dl_bins = [];
		var num_coord_systems = root._num_coord_systems;
		for (var i=0; i<num_coord_systems; ++i) {
			var coord_system = root["x"][i];
			if (coord_system["k"]) {
				var num_files = coord_system["k"][1];
				for (var j=0; j<num_files; ++j) {
					var bin_filename = "points_" + i + "_" + j + ".bin";
					var bin_filepath = path.join(output_folder, "points", bin_filename);
					var bin_url = root_url + bin_filename;
					var dl_bin = new DownloadableObject();
					dl_bin.Init(bin_filepath, bin_url);
					dl_bins.push(dl_bin);
				}
			}
		}
		
		dl.SaveToDisk(function() {
			if (dl_bins.length == 0) {
				// Some synth do not have any point cloud :(
				onComplete();
			} else {			
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
			}
		});
	});
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

module.exports = DownloadPS1;