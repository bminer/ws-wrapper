/* This chat server uses "ws" for Node.js WebSockets and the "koa" web
	framework. "node-module-concat" is used to bundle the client-side code at
	run-time.

	This example does *NOT* use ws-server-wrapper.  For an example using
	ws-server-wrapper, visit the ws-server-wrapper Github repo.
*/
const http = require("http")
	, fs = require("fs")
	, WebSocketServer = require("ws").Server
	, WebSocketWrapper = require("../")
	, moduleConcat = require("module-concat")
	, koa = require("koa")
	, router = require("koa-router")();

// Create new HTTP server using koa and a new WebSocketServer
let app = koa()
	, server = http.createServer(app.callback() )
	, socketServer = WebSocketServer({server: server});

// Save all connected `sockets`
var sockets = [];
// Save all logged in `users`; keys are usernames, values are the sockets
var users = {};
// Listen for a socket to connect
socketServer.on("connection", function(socket) {
	// Upon connection, wrap the socket and save it in the `sockets` array
	var socket = new WebSocketWrapper(socket);
	sockets.push(socket);
	// Setup event handlers on the socket
	socket.of("chat").on("login", (username) => {
		if(username === "system" ||
			(users[username] && users[username] !== socket) )
		{
			// Error is sent back to the client
			throw new Error(`Username '${username}' is taken!`);
		} else {
			// Notify all other users
			for(var i in users) {
				users[i].of("chat").emit("message", "system", username +
					" has logged in");
			}
			// Save the username
			socket.set("username", username);
			users[username] = socket;
		}
	});
	socket.of("chat").on("message", (msg) => {
		var username = socket.get("username");
		if(username) {
			// We're logged in, so relay the message to all clients
			for(var i in users) {
				users[i].of("chat").emit("message", username, msg);
			}
		} else {
			throw new Error("Please log in first!");
		}
	});
	socket.of("chat").on("logout", () => {
		var username = socket.get("username");
		if(users[username]) {
			delete users[username];
			// Notify all other users
			for(var i in users) {
				users[i].of("chat").emit("message", "system", username +
					" has logged out");
			}
		}
	});
	// Upon disconnect, free resources
	socket.on("disconnect", () => {
		var idx = sockets.indexOf(socket);
		if(idx >= 0)
			sockets.splice(idx, 1);
		var username = socket.get("username");
		if(users[username]) {
			delete users[username];
			// Notify all other users
			for(var i in users) {
				users[i].of("chat").emit("message", "system", username +
					" has logged out");
			}
		}
	});
});

// Setup koa router
app.use(router.routes() );
// Serve index.html and client.js
router.get(["/"], function* () {
	this.type = "text/html";
	this.body = fs.createReadStream(__dirname + "/index.html");
});
router.get(["/client.js"], function* () {
	this.type = "text/javascript";
	this.body = fs.createReadStream(__dirname + "/client_build.js");
});

// Build client.js using "node-module-concat"
moduleConcat(__dirname + "/client.js", __dirname + "/client_build.js", function(err, stats) {
	if(err) {
		throw err;
	}
	const files = stats.files;
	console.log(`${files.length} files combined into build:\n`, files);

	// Start the server after building client_build.js
	const PORT = process.env.PORT || 3000;
	server.listen(PORT, () => {
		console.log("Listening on port " + PORT);
	});
});
