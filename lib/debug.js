// Quick and dirty debug function
module.exports = function debug() {
	if((typeof localStorage === "object" && localStorage.debug) ||
		(typeof process === "object" && process.env &&
			process.env.NODE_ENV === "DEBUG") )
	{
		return console.log.apply(console, arguments);
	}
}
