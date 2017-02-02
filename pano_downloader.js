var http      = require('http');
var https     = require('https');
var fs        = require('fs');
var fs_extra  = require('fs-extra');
var path      = require('path');
var morton    = require('morton');
var zipFolder = require('./zip-folder');
var Polygon   = require('./polygon');
var async     = require('async');
var DownloadableObject =  require('./downloadable_object').DownloadableObject;

var _max_threading = 20;

// Mobile panorama: (0e10e9d5-cf30-421e-9e13-9f8f8e04033a)
// https://cdn1.ps1.photosynth.net/pano/c01001100-ABgnUD5kQz4/0.json
// https://cdn1.ps1.photosynth.net/pano/c01001100-ABgnUD5kQz4/atlas.jpg
// https://cdn1.ps1.photosynth.net/pano/c01001100-ABgnUD5kQz4/thumb.jpg
// https://cdn3.ps1.photosynth.net/image/m01001300-ABgnmnRkQz4_files/8/0_0.jpg
// 0a462c04-15a6-4ebc-958d-3cf7db846f91 - partial pano

// ICE panorama: (d724f8fa-f7a1-454f-809b-3d2f3a2976e7)
// https://cdn4.ps1.photosynth.net/pano/d724f8fa-f7a1-454f-809b-3d2f3a2976e7/cubeface/6.json
// https://cdn4.ps1.photosynth.net/media/d724f8fa-f7a1-454f-809b-3d2f3a2976e7/cubeface/thumb.jpg
// https://cdn4.ps1.photosynth.net/media/d724f8fa-f7a1-454f-809b-3d2f3a2976e7/cubeface/atlas.jpg
// https://cdn2.ps1.photosynth.net/media/d724f8fa-f7a1-454f-809b-3d2f3a2976e7/cubeface/front/9/1_0.jpg

function GetFilename(url) {
	return url.split("/").pop();
}

function DownloadPano(json, output_folder, guid, parent_folder) {	
	var json_url = json.CollectionUrl;   // json_url end with https://my/long/url/x.json
	var thumbnail_url = json.ThumbnailUrl;
	var temp = json_url.split("/");
	var json_filename = temp.pop();      // x.json
	var root_url = temp.join("/") + "/"; // https://my/long/url/
	
	var dl_items = [];
	
	//Download previous json file iterations.
	var json_index = parseInt(json_filename.replace(".json"), 10);
	for (var i=0; i<=json_index; ++i) {
		var current_json_filename = "" + i + ".json";
		var dl_item = new DownloadableObject();
		dl_item.Init(path.join(output_folder, current_json_filename), root_url + current_json_filename);
		dl_items.push(dl_item);
	}
	
	// 100x100 thumbnail
	var dl_thumb_item = new DownloadableObject();
	dl_thumb_item.Init(path.join(output_folder, GetFilename(thumbnail_url)), thumbnail_url);
	dl_items.push(dl_thumb_item);
	
	// atlas.jpg
	var dl_atlas_item = new DownloadableObject();
	dl_atlas_item.Init(path.join(output_folder, "atlas.jpg"), thumbnail_url.replace("thumb.jpg", "atlas.jpg"));
	dl_items.push(dl_atlas_item);
	
	DownloadPanoMetadata(json_url, json_filename, output_folder, function(faces) {
		var face_names = ["right", "left", "bottom", "top", "front", "back"];
		for (var i=0; i<face_names.length; ++i) {
			var face_name = face_names[i];
			if (faces[face_name]) {
				dl_items = dl_items.concat(DownloadFace(faces[face_name], face_name, output_folder));
			}
		}
		console.log("downloading " + dl_items.length + " items");
		
		DownloadAllItems(dl_items, output_folder, function() {
			zipFolder(output_folder, path.join(parent_folder, guid + ".zip"), function(err) {
				if (err) {
					console.log('oh no!', err);
				} else {
					fs_extra.removeSync(output_folder);
					console.log("Done Zipping: " + guid);
				}
			});
			console.log("done");
		});
	});
}

function DownloadAllItems(dl_items, output_folder, onComplete) {
	var q = async.queue(function(task, callback) {
		task.DownloadToFile(function() {
			task.Clear();
			callback(null, true);
		}, function() {
			callback("error", false);
		});
	}, _max_threading);
	q.drain = function() {
		onComplete();
	};
	for (var i=0; i<dl_items.length; ++i) {
		q.push(dl_items[i]);
	}
}

function DownloadPanoMetadata(json_url, json_filename, output_folder, onComplete) {
	var dl = new DownloadableObject();
	dl.Init(path.join(output_folder, json_filename), json_url);
	dl.DownloadToMemory(function() {
		var json = dl.ParseJson();
		var root;
		for (var guid in json["l"]) {
			root = json["l"][guid];
		}
		var json_cubemaps = root["x"][0]["cubemaps"][0];
		onComplete(json_cubemaps);
	}, function() {
		onComplete([]);
	});
}

function CreatePoint(point, w, h) {
	var p = point;
	var eps = 0.1;
	//p.x = Math.max(Math.min(p.x, w-eps), eps);
	//p.y = Math.max(Math.min(p.y, h-eps), eps);
	return p;
}

function DownloadFace(face, face_name, output_folder) {
	var dimension = face.d;
	var vertices = face.clip.vertices;
	var loops = face.clip.loops;
	
	var width = dimension[0];
	var height = dimension[1];
	var full_width = width;
	var full_height = height;
	
	// Panoramas are store as cubemap.
	//
	// This is on square face of the panorama:
	// 
	//       full_width
	// <----------------------->
	//
	// -------------------------  ^
	// |                       |  |
	// |                       |  |
	// |                       |  |
	// |     A+++++++++++B     |  |
	// |     +++++++++++++     |  | full_height (should be equal to full_width)
	// |     D+++++++++++C     |  |
	// |           ^           |  |
	// |            \          |  |
	// --------------\----------  v
	//                \
	//                 \
	// This is the sub-region actually containing pixel data.
	// It is defined as a polygon with a list of vertices (A,B,C,D).
	//
	// The full square face is divided in tiles, but only tiles intersecting
	// with area containing pixel data are store on the server. Requesting
	// a tile not overlapping with the pixel data area result in a 404.

	var image_polygon;
	if (vertices.length % 2 == 0) {
		var image_polygon = new Polygon({x: vertices[0], y: vertices[1]});
		for (var i=0; i<vertices.length; i += 2) {
			image_polygon.addAbsolutePoint({x: vertices[i], y: vertices[i+1]});
		}
	} else {
		// This case should not be needed.
		// Creating a polygon covering the full square face.
		image_polygon = new Polygon({x: 0, y: 0});
		image_polygon.addAbsolutePoint({x: 0, y: 0});
		image_polygon.addAbsolutePoint({x: 0, y: full_height});
		image_polygon.addAbsolutePoint({x: full_width, y: full_height});
		image_polygon.addAbsolutePoint({x: full_width, y: 0});
	}
	
	var image_folder = path.join(output_folder, face_name);
	var image_root_url = face.u;
	var dl_tiles = [];
	
	var tilesize = 256;
	var num_columns = Math.ceil(width / tilesize);
	var num_rows = Math.ceil(height / tilesize);
	var num_levels = GetPOT(Math.max(width, height));
	var multiplier = 1;
	while (num_levels >= 0) {
		var current_level_folder = image_folder + "/" + num_levels;
		fs_extra.mkdirsSync(current_level_folder);
		var current_tilesize = tilesize*multiplier;
		for (var x=0; x<num_columns; ++x) {
			for (var y=0; y<num_rows; ++y) {
				
				var tile_x = x*current_tilesize;
				var tile_y = y*current_tilesize;
				
				// a---b   a = (tile_x, tile_y)
				// | e |
				// c---d
				
				var corner_a = {x:tile_x,                      y: tile_y};
				var corner_b = {x:tile_x+current_tilesize,     y: tile_y};
				var corner_c = {x:tile_x,                      y: tile_y+current_tilesize};
				var corner_d = {x:tile_x+current_tilesize,     y: tile_y+current_tilesize};
				var corner_e = {x:tile_x+current_tilesize*0.5, y: tile_y+current_tilesize*0.5};
				var tile_polygon = new Polygon(corner_e);
				tile_polygon.addAbsolutePoint(corner_c);
				tile_polygon.addAbsolutePoint(corner_a);
				tile_polygon.addAbsolutePoint(corner_b);
				tile_polygon.addAbsolutePoint(corner_d);
				
				if (image_polygon.intersectsWith(tile_polygon)) {
					// It's ok to not do the polygon intersection check but it will just results
					// in a lot of 404 requests. See ascii art comment above.
					var tile_filename = x + "_" + y + ".jpg";
					var tile_filepath = current_level_folder + "/" + tile_filename;
					var tile_url = image_root_url + num_levels + "/" + tile_filename;
					var dl_tile = new DownloadableObject();
					dl_tile.Init(tile_filepath, tile_url);
					dl_tiles.push(dl_tile);
				}
			}
		}
		if (num_columns == 1 && num_rows == 1) {
			break;
		}
		width /= 2;
		height /= 2;
		multiplier *= 2;
		num_columns = Math.ceil(width / tilesize);
		num_rows = Math.ceil(height / tilesize);
		num_levels--;
	}
	
	return dl_tiles;
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

module.exports = DownloadPano;
