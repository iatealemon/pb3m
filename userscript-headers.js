import pkg from "./package.json" with { type: "json"};

export default 
`// ==UserScript==
// @name PB3M
// @description ${pkg.description}
// @version ${pkg.version}
// @author ${pkg.author}
// @match https://www.plazmaburst.net/**
// @connect github.com
// @connect githubusercontent.com
// @grant GM.xmlHttpRequest
// @run-at document-start
// ==/UserScript==`;