/* This chat server uses "ws" for Node.js WebSockets and the "koa" web
	framework. "node-module-concat" is used to bundle the client-side code at
	run-time.

	This example does *NOT* use ws-server-wrapper.  For an example using
	ws-server-wrapper, visit the ws-server-wrapper Github repo.
*/
const http = require("http"),
	fs = require("fs"),
	WebSocketServer = require("ws").Server,
	WebSocketWrapper = require("../"),
	moduleConcat = require("module-concat"),
	Koa = require("koa"),
	router = require("koa-router")()

// Create new HTTP server using koa and a new WebSocketServer
const app = new Koa(),
	server = http.createServer(app.callback()),
	socketServer = new WebSocketServer({ server })

// Save all connected `sockets`
const sockets = []
// Save all logged in `users`; keys are usernames, values are the sockets
const users = {}
// Listen for a socket to connect
socketServer.on("connection", function (socket) {
	// Upon connection, wrap the socket and save it in the `sockets` array
	socket = new WebSocketWrapper(socket)
	sockets.push(socket)
	// Setup event handlers on the socket
	socket.of("chat").on("login", (username) => {
		if (
			username === "system" ||
			(users[username] && users[username] !== socket)
		) {
			// Error is sent back to the client
			throw new Error(`Username '${username}' is taken!`)
		} else {
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged in")
			}
			// Save the username
			socket.set("username", username)
			users[username] = socket
		}
	})
	socket.of("chat").on("message", (msg) => {
		const username = socket.get("username")
		if (username) {
			// We're logged in, so relay the message to all clients
			for (const i in users) {
				users[i].of("chat").emit("message", username, msg)
			}
		} else {
			throw new Error("Please log in first!")
		}
	})
	socket.of("chat").on("logout", () => {
		const username = socket.get("username")
		if (users[username]) {
			delete users[username]
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged out")
			}
		}
	})
	// Upon disconnect, free resources
	socket.on("disconnect", () => {
		const idx = sockets.indexOf(socket)
		if (idx >= 0) {
			sockets.splice(idx, 1)
		}
		const username = socket.get("username")
		if (users[username]) {
			delete users[username]
			// Notify all other users
			for (const i in users) {
				users[i]
					.of("chat")
					.emit("message", "system", username + " has logged out")
			}
		}
	})
})

// Setup koa router
app.use(router.routes())
// Serve index.html and client.js
router.get("/", (ctx, next) => {
	ctx.type = "text/html"
	ctx.body = fs.createReadStream(__dirname + "/index.html")
})
router.get("/client.js", (ctx, next) => {
	ctx.type = "text/javascript"
	ctx.body = fs.createReadStream(__dirname + "/client_build.js")
})

// Build client.js using "node-module-concat"
moduleConcat(
	__dirname + "/client.js",
	__dirname + "/client_build.js",
	function (err, stats) {
		if (err) {
			throw err
		}
		const { files } = stats
		console.log(`${files.length} files combined into build:\n`, files)

		// Start the server after building client_build.js
		const { PORT = 3000 } = process.env
		server.listen(PORT, () => {
			console.log("Listening on port " + PORT)
		})
	}
)
