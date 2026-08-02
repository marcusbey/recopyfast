/*! ReCopyFast embed widget — GENERATED FILE, DO NOT EDIT.
 *  Source: public/embed/recopyfast.src.js
 *  Rebuild: node scripts/build-embed.mjs
 *  Bundled socket.io-client: 4.8.1
 */
// @generated-from-sha256 ba550ddba41e47a0b5c2232ae9e3ab655e6f434a7ea3de6ead0e3e6827adf7f2
(()=>{var Ue=Object.defineProperty;var Ve=(s,e)=>{for(var t in e)Ue(s,t,{get:e[t],enumerable:!0})};var d=Object.create(null);d.open="0";d.close="1";d.ping="2";d.pong="3";d.message="4";d.upgrade="5";d.noop="6";var B=Object.create(null);Object.keys(d).forEach(s=>{B[d[s]]=s});var N={type:"error",data:"parser error"};var ue=typeof Blob=="function"||typeof Blob!="undefined"&&Object.prototype.toString.call(Blob)==="[object BlobConstructor]",le=typeof ArrayBuffer=="function",pe=s=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(s):s&&s.buffer instanceof ArrayBuffer,L=({type:s,data:e},t,r)=>ue&&e instanceof Blob?t?r(e):he(e,r):le&&(e instanceof ArrayBuffer||pe(e))?t?r(e):he(new Blob([e]),r):r(d[s]+(e||"")),he=(s,e)=>{let t=new FileReader;return t.onload=function(){let r=t.result.split(",")[1];e("b"+(r||""))},t.readAsDataURL(s)};function fe(s){return s instanceof Uint8Array?s:s instanceof ArrayBuffer?new Uint8Array(s):new Uint8Array(s.buffer,s.byteOffset,s.byteLength)}var $;function de(s,e){if(ue&&s.data instanceof Blob)return s.data.arrayBuffer().then(fe).then(e);if(le&&(s.data instanceof ArrayBuffer||pe(s.data)))return e(fe(s.data));L(s,!1,t=>{$||($=new TextEncoder),e($.encode(t))})}var me="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",P=typeof Uint8Array=="undefined"?[]:new Uint8Array(256);for(let s=0;s<me.length;s++)P[me.charCodeAt(s)]=s;var ye=s=>{let e=s.length*.75,t=s.length,r,i=0,n,o,c,h;s[s.length-1]==="="&&(e--,s[s.length-2]==="="&&e--);let m=new ArrayBuffer(e),p=new Uint8Array(m);for(r=0;r<t;r+=4)n=P[s.charCodeAt(r)],o=P[s.charCodeAt(r+1)],c=P[s.charCodeAt(r+2)],h=P[s.charCodeAt(r+3)],p[i++]=n<<2|o>>4,p[i++]=(o&15)<<4|c>>2,p[i++]=(c&3)<<6|h&63;return m};var Me=typeof ArrayBuffer=="function",q=(s,e)=>{if(typeof s!="string")return{type:"message",data:ge(s,e)};let t=s.charAt(0);return t==="b"?{type:"message",data:He(s.substring(1),e)}:B[t]?s.length>1?{type:B[t],data:s.substring(1)}:{type:B[t]}:N},He=(s,e)=>{if(Me){let t=ye(s);return ge(t,e)}else return{base64:!0,data:s}},ge=(s,e)=>{switch(e){case"blob":return s instanceof Blob?s:new Blob([s]);case"arraybuffer":default:return s instanceof ArrayBuffer?s:s.buffer}};var _e="",be=(s,e)=>{let t=s.length,r=new Array(t),i=0;s.forEach((n,o)=>{L(n,!1,c=>{r[o]=c,++i===t&&e(r.join(_e))})})},we=(s,e)=>{let t=s.split(_e),r=[];for(let i=0;i<t.length;i++){let n=q(t[i],e);if(r.push(n),n.type==="error")break}return r};function Ee(){return new TransformStream({transform(s,e){de(s,t=>{let r=t.length,i;if(r<126)i=new Uint8Array(1),new DataView(i.buffer).setUint8(0,r);else if(r<65536){i=new Uint8Array(3);let n=new DataView(i.buffer);n.setUint8(0,126),n.setUint16(1,r)}else{i=new Uint8Array(9);let n=new DataView(i.buffer);n.setUint8(0,127),n.setBigUint64(1,BigInt(r))}s.data&&typeof s.data!="string"&&(i[0]|=128),e.enqueue(i),e.enqueue(t)})}})}var Q;function M(s){return s.reduce((e,t)=>e+t.length,0)}function H(s,e){if(s[0].length===e)return s.shift();let t=new Uint8Array(e),r=0;for(let i=0;i<e;i++)t[i]=s[0][r++],r===s[0].length&&(s.shift(),r=0);return s.length&&r<s[0].length&&(s[0]=s[0].slice(r)),t}function ke(s,e){Q||(Q=new TextDecoder);let t=[],r=0,i=-1,n=!1;return new TransformStream({transform(o,c){for(t.push(o);;){if(r===0){if(M(t)<1)break;let h=H(t,1);n=(h[0]&128)===128,i=h[0]&127,i<126?r=3:i===126?r=1:r=2}else if(r===1){if(M(t)<2)break;let h=H(t,2);i=new DataView(h.buffer,h.byteOffset,h.length).getUint16(0),r=3}else if(r===2){if(M(t)<8)break;let h=H(t,8),m=new DataView(h.buffer,h.byteOffset,h.length),p=m.getUint32(0);if(p>Math.pow(2,21)-1){c.enqueue(N);break}i=p*Math.pow(2,32)+m.getUint32(4),r=3}else{if(M(t)<i)break;let h=H(t,i);c.enqueue(q(n?h:Q.decode(h),e)),r=0}if(i===0||i>s){c.enqueue(N);break}}}})}var G=4;function f(s){if(s)return We(s)}function We(s){for(var e in f.prototype)s[e]=f.prototype[e];return s}f.prototype.on=f.prototype.addEventListener=function(s,e){return this._callbacks=this._callbacks||{},(this._callbacks["$"+s]=this._callbacks["$"+s]||[]).push(e),this};f.prototype.once=function(s,e){function t(){this.off(s,t),e.apply(this,arguments)}return t.fn=e,this.on(s,t),this};f.prototype.off=f.prototype.removeListener=f.prototype.removeAllListeners=f.prototype.removeEventListener=function(s,e){if(this._callbacks=this._callbacks||{},arguments.length==0)return this._callbacks={},this;var t=this._callbacks["$"+s];if(!t)return this;if(arguments.length==1)return delete this._callbacks["$"+s],this;for(var r,i=0;i<t.length;i++)if(r=t[i],r===e||r.fn===e){t.splice(i,1);break}return t.length===0&&delete this._callbacks["$"+s],this};f.prototype.emit=function(s){this._callbacks=this._callbacks||{};for(var e=new Array(arguments.length-1),t=this._callbacks["$"+s],r=1;r<arguments.length;r++)e[r-1]=arguments[r];if(t){t=t.slice(0);for(var r=0,i=t.length;r<i;++r)t[r].apply(this,e)}return this};f.prototype.emitReserved=f.prototype.emit;f.prototype.listeners=function(s){return this._callbacks=this._callbacks||{},this._callbacks["$"+s]||[]};f.prototype.hasListeners=function(s){return!!this.listeners(s).length};var y=typeof Promise=="function"&&typeof Promise.resolve=="function"?e=>Promise.resolve().then(e):(e,t)=>t(e,0),u=typeof self!="undefined"?self:typeof window!="undefined"?window:Function("return this")(),ve="arraybuffer";function W(s,...e){return e.reduce((t,r)=>(s.hasOwnProperty(r)&&(t[r]=s[r]),t),{})}var Ke=u.setTimeout,Ye=u.clearTimeout;function g(s,e){e.useNativeTimers?(s.setTimeoutFn=Ke.bind(u),s.clearTimeoutFn=Ye.bind(u)):(s.setTimeoutFn=u.setTimeout.bind(u),s.clearTimeoutFn=u.clearTimeout.bind(u))}var Je=1.33;function xe(s){return typeof s=="string"?ze(s):Math.ceil((s.byteLength||s.size)*Je)}function ze(s){let e=0,t=0;for(let r=0,i=s.length;r<i;r++)e=s.charCodeAt(r),e<128?t+=1:e<2048?t+=2:e<55296||e>=57344?t+=3:(r++,t+=4);return t}function K(){return Date.now().toString(36).substring(3)+Math.random().toString(36).substring(2,5)}function Te(s){let e="";for(let t in s)s.hasOwnProperty(t)&&(e.length&&(e+="&"),e+=encodeURIComponent(t)+"="+encodeURIComponent(s[t]));return e}function Ae(s){let e={},t=s.split("&");for(let r=0,i=t.length;r<i;r++){let n=t[r].split("=");e[decodeURIComponent(n[0])]=decodeURIComponent(n[1])}return e}var Y=class extends Error{constructor(e,t,r){super(e),this.description=t,this.context=r,this.type="TransportError"}},_=class extends f{constructor(e){super(),this.writable=!1,g(this,e),this.opts=e,this.query=e.query,this.socket=e.socket,this.supportsBinary=!e.forceBase64}onError(e,t,r){return super.emitReserved("error",new Y(e,t,r)),this}open(){return this.readyState="opening",this.doOpen(),this}close(){return(this.readyState==="opening"||this.readyState==="open")&&(this.doClose(),this.onClose()),this}send(e){this.readyState==="open"&&this.write(e)}onOpen(){this.readyState="open",this.writable=!0,super.emitReserved("open")}onData(e){let t=q(e,this.socket.binaryType);this.onPacket(t)}onPacket(e){super.emitReserved("packet",e)}onClose(e){this.readyState="closed",super.emitReserved("close",e)}pause(e){}createUri(e,t={}){return e+"://"+this._hostname()+this._port()+this.opts.path+this._query(t)}_hostname(){let e=this.opts.hostname;return e.indexOf(":")===-1?e:"["+e+"]"}_port(){return this.opts.port&&(this.opts.secure&&Number(this.opts.port)!==443||!this.opts.secure&&Number(this.opts.port)!==80)?":"+this.opts.port:""}_query(e){let t=Te(e);return t.length?"?"+t:""}};var D=class extends _{constructor(){super(...arguments),this._polling=!1}get name(){return"polling"}doOpen(){this._poll()}pause(e){this.readyState="pausing";let t=()=>{this.readyState="paused",e()};if(this._polling||!this.writable){let r=0;this._polling&&(r++,this.once("pollComplete",function(){--r||t()})),this.writable||(r++,this.once("drain",function(){--r||t()}))}else t()}_poll(){this._polling=!0,this.doPoll(),this.emitReserved("poll")}onData(e){let t=r=>{if(this.readyState==="opening"&&r.type==="open"&&this.onOpen(),r.type==="close")return this.onClose({description:"transport closed by the server"}),!1;this.onPacket(r)};we(e,this.socket.binaryType).forEach(t),this.readyState!=="closed"&&(this._polling=!1,this.emitReserved("pollComplete"),this.readyState==="open"&&this._poll())}doClose(){let e=()=>{this.write([{type:"close"}])};this.readyState==="open"?e():this.once("open",e)}write(e){this.writable=!1,be(e,t=>{this.doWrite(t,()=>{this.writable=!0,this.emitReserved("drain")})})}uri(){let e=this.opts.secure?"https":"http",t=this.query||{};return this.opts.timestampRequests!==!1&&(t[this.opts.timestampParam]=K()),!this.supportsBinary&&!t.sid&&(t.b64=1),this.createUri(e,t)}};var Re=!1;try{Re=typeof XMLHttpRequest!="undefined"&&"withCredentials"in new XMLHttpRequest}catch(s){}var Oe=Re;function Xe(){}var j=class extends D{constructor(e){if(super(e),typeof location!="undefined"){let t=location.protocol==="https:",r=location.port;r||(r=t?"443":"80"),this.xd=typeof location!="undefined"&&e.hostname!==location.hostname||r!==e.port}}doWrite(e,t){let r=this.request({method:"POST",data:e});r.on("success",t),r.on("error",(i,n)=>{this.onError("xhr post error",i,n)})}doPoll(){let e=this.request();e.on("data",this.onData.bind(this)),e.on("error",(t,r)=>{this.onError("xhr poll error",t,r)}),this.pollXhr=e}},w=class s extends f{constructor(e,t,r){super(),this.createRequest=e,g(this,r),this._opts=r,this._method=r.method||"GET",this._uri=t,this._data=r.data!==void 0?r.data:null,this._create()}_create(){var e;let t=W(this._opts,"agent","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","autoUnref");t.xdomain=!!this._opts.xd;let r=this._xhr=this.createRequest(t);try{r.open(this._method,this._uri,!0);try{if(this._opts.extraHeaders){r.setDisableHeaderCheck&&r.setDisableHeaderCheck(!0);for(let i in this._opts.extraHeaders)this._opts.extraHeaders.hasOwnProperty(i)&&r.setRequestHeader(i,this._opts.extraHeaders[i])}}catch(i){}if(this._method==="POST")try{r.setRequestHeader("Content-type","text/plain;charset=UTF-8")}catch(i){}try{r.setRequestHeader("Accept","*/*")}catch(i){}(e=this._opts.cookieJar)===null||e===void 0||e.addCookies(r),"withCredentials"in r&&(r.withCredentials=this._opts.withCredentials),this._opts.requestTimeout&&(r.timeout=this._opts.requestTimeout),r.onreadystatechange=()=>{var i;r.readyState===3&&((i=this._opts.cookieJar)===null||i===void 0||i.parseCookies(r.getResponseHeader("set-cookie"))),r.readyState===4&&(r.status===200||r.status===1223?this._onLoad():this.setTimeoutFn(()=>{this._onError(typeof r.status=="number"?r.status:0)},0))},r.send(this._data)}catch(i){this.setTimeoutFn(()=>{this._onError(i)},0);return}typeof document!="undefined"&&(this._index=s.requestsCount++,s.requests[this._index]=this)}_onError(e){this.emitReserved("error",e,this._xhr),this._cleanup(!0)}_cleanup(e){if(!(typeof this._xhr=="undefined"||this._xhr===null)){if(this._xhr.onreadystatechange=Xe,e)try{this._xhr.abort()}catch(t){}typeof document!="undefined"&&delete s.requests[this._index],this._xhr=null}}_onLoad(){let e=this._xhr.responseText;e!==null&&(this.emitReserved("data",e),this.emitReserved("success"),this._cleanup())}abort(){this._cleanup()}};w.requestsCount=0;w.requests={};if(typeof document!="undefined"){if(typeof attachEvent=="function")attachEvent("onunload",Se);else if(typeof addEventListener=="function"){let s="onpagehide"in u?"pagehide":"unload";addEventListener(s,Se,!1)}}function Se(){for(let s in w.requests)w.requests.hasOwnProperty(s)&&w.requests[s].abort()}var $e=(function(){let s=Ce({xdomain:!1});return s&&s.responseType!==null})(),E=class extends j{constructor(e){super(e);let t=e&&e.forceBase64;this.supportsBinary=$e&&!t}request(e={}){return Object.assign(e,{xd:this.xd},this.opts),new w(Ce,this.uri(),e)}};function Ce(s){let e=s.xdomain;try{if(typeof XMLHttpRequest!="undefined"&&(!e||Oe))return new XMLHttpRequest}catch(t){}if(!e)try{return new u[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP")}catch(t){}}var Be=typeof navigator!="undefined"&&typeof navigator.product=="string"&&navigator.product.toLowerCase()==="reactnative",ee=class extends _{get name(){return"websocket"}doOpen(){let e=this.uri(),t=this.opts.protocols,r=Be?{}:W(this.opts,"agent","perMessageDeflate","pfx","key","passphrase","cert","ca","ciphers","rejectUnauthorized","localAddress","protocolVersion","origin","maxPayload","family","checkServerIdentity");this.opts.extraHeaders&&(r.headers=this.opts.extraHeaders);try{this.ws=this.createSocket(e,t,r)}catch(i){return this.emitReserved("error",i)}this.ws.binaryType=this.socket.binaryType,this.addEventListeners()}addEventListeners(){this.ws.onopen=()=>{this.opts.autoUnref&&this.ws._socket.unref(),this.onOpen()},this.ws.onclose=e=>this.onClose({description:"websocket connection closed",context:e}),this.ws.onmessage=e=>this.onData(e.data),this.ws.onerror=e=>this.onError("websocket error",e)}write(e){this.writable=!1;for(let t=0;t<e.length;t++){let r=e[t],i=t===e.length-1;L(r,this.supportsBinary,n=>{try{this.doWrite(r,n)}catch(o){}i&&y(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){typeof this.ws!="undefined"&&(this.ws.onerror=()=>{},this.ws.close(),this.ws=null)}uri(){let e=this.opts.secure?"wss":"ws",t=this.query||{};return this.opts.timestampRequests&&(t[this.opts.timestampParam]=K()),this.supportsBinary||(t.b64=1),this.createUri(e,t)}},Z=u.WebSocket||u.MozWebSocket,k=class extends ee{createSocket(e,t,r){return Be?new Z(e,t,r):t?new Z(e,t):new Z(e)}doWrite(e,t){this.ws.send(t)}};var T=class extends _{get name(){return"webtransport"}doOpen(){try{this._transport=new WebTransport(this.createUri("https"),this.opts.transportOptions[this.name])}catch(e){return this.emitReserved("error",e)}this._transport.closed.then(()=>{this.onClose()}).catch(e=>{this.onError("webtransport error",e)}),this._transport.ready.then(()=>{this._transport.createBidirectionalStream().then(e=>{let t=ke(Number.MAX_SAFE_INTEGER,this.socket.binaryType),r=e.readable.pipeThrough(t).getReader(),i=Ee();i.readable.pipeTo(e.writable),this._writer=i.writable.getWriter();let n=()=>{r.read().then(({done:c,value:h})=>{c||(this.onPacket(h),n())}).catch(c=>{})};n();let o={type:"open"};this.query.sid&&(o.data=`{"sid":"${this.query.sid}"}`),this._writer.write(o).then(()=>this.onOpen())})})}write(e){this.writable=!1;for(let t=0;t<e.length;t++){let r=e[t],i=t===e.length-1;this._writer.write(r).then(()=>{i&&y(()=>{this.writable=!0,this.emitReserved("drain")},this.setTimeoutFn)})}}doClose(){var e;(e=this._transport)===null||e===void 0||e.close()}};var te={websocket:k,webtransport:T,polling:E};var Qe=/^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/,Ge=["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"];function A(s){if(s.length>8e3)throw"URI too long";let e=s,t=s.indexOf("["),r=s.indexOf("]");t!=-1&&r!=-1&&(s=s.substring(0,t)+s.substring(t,r).replace(/:/g,";")+s.substring(r,s.length));let i=Qe.exec(s||""),n={},o=14;for(;o--;)n[Ge[o]]=i[o]||"";return t!=-1&&r!=-1&&(n.source=e,n.host=n.host.substring(1,n.host.length-1).replace(/;/g,":"),n.authority=n.authority.replace("[","").replace("]","").replace(/;/g,":"),n.ipv6uri=!0),n.pathNames=je(n,n.path),n.queryKey=Ze(n,n.query),n}function je(s,e){let t=/\/{2,9}/g,r=e.replace(t,"/").split("/");return(e.slice(0,1)=="/"||e.length===0)&&r.splice(0,1),e.slice(-1)=="/"&&r.splice(r.length-1,1),r}function Ze(s,e){let t={};return e.replace(/(?:^|&)([^&=]*)=?([^&]*)/g,function(r,i,n){i&&(t[i]=n)}),t}var se=typeof addEventListener=="function"&&typeof removeEventListener=="function",J=[];se&&addEventListener("offline",()=>{J.forEach(s=>s())},!1);var v=class s extends f{constructor(e,t){if(super(),this.binaryType=ve,this.writeBuffer=[],this._prevBufferLen=0,this._pingInterval=-1,this._pingTimeout=-1,this._maxPayload=-1,this._pingTimeoutTime=1/0,e&&typeof e=="object"&&(t=e,e=null),e){let r=A(e);t.hostname=r.host,t.secure=r.protocol==="https"||r.protocol==="wss",t.port=r.port,r.query&&(t.query=r.query)}else t.host&&(t.hostname=A(t.host).host);g(this,t),this.secure=t.secure!=null?t.secure:typeof location!="undefined"&&location.protocol==="https:",t.hostname&&!t.port&&(t.port=this.secure?"443":"80"),this.hostname=t.hostname||(typeof location!="undefined"?location.hostname:"localhost"),this.port=t.port||(typeof location!="undefined"&&location.port?location.port:this.secure?"443":"80"),this.transports=[],this._transportsByName={},t.transports.forEach(r=>{let i=r.prototype.name;this.transports.push(i),this._transportsByName[i]=r}),this.opts=Object.assign({path:"/engine.io",agent:!1,withCredentials:!1,upgrade:!0,timestampParam:"t",rememberUpgrade:!1,addTrailingSlash:!0,rejectUnauthorized:!0,perMessageDeflate:{threshold:1024},transportOptions:{},closeOnBeforeunload:!1},t),this.opts.path=this.opts.path.replace(/\/$/,"")+(this.opts.addTrailingSlash?"/":""),typeof this.opts.query=="string"&&(this.opts.query=Ae(this.opts.query)),se&&(this.opts.closeOnBeforeunload&&(this._beforeunloadEventListener=()=>{this.transport&&(this.transport.removeAllListeners(),this.transport.close())},addEventListener("beforeunload",this._beforeunloadEventListener,!1)),this.hostname!=="localhost"&&(this._offlineEventListener=()=>{this._onClose("transport close",{description:"network connection lost"})},J.push(this._offlineEventListener))),this.opts.withCredentials&&(this._cookieJar=void 0),this._open()}createTransport(e){let t=Object.assign({},this.opts.query);t.EIO=G,t.transport=e,this.id&&(t.sid=this.id);let r=Object.assign({},this.opts,{query:t,socket:this,hostname:this.hostname,secure:this.secure,port:this.port},this.opts.transportOptions[e]);return new this._transportsByName[e](r)}_open(){if(this.transports.length===0){this.setTimeoutFn(()=>{this.emitReserved("error","No transports available")},0);return}let e=this.opts.rememberUpgrade&&s.priorWebsocketSuccess&&this.transports.indexOf("websocket")!==-1?"websocket":this.transports[0];this.readyState="opening";let t=this.createTransport(e);t.open(),this.setTransport(t)}setTransport(e){this.transport&&this.transport.removeAllListeners(),this.transport=e,e.on("drain",this._onDrain.bind(this)).on("packet",this._onPacket.bind(this)).on("error",this._onError.bind(this)).on("close",t=>this._onClose("transport close",t))}onOpen(){this.readyState="open",s.priorWebsocketSuccess=this.transport.name==="websocket",this.emitReserved("open"),this.flush()}_onPacket(e){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing")switch(this.emitReserved("packet",e),this.emitReserved("heartbeat"),e.type){case"open":this.onHandshake(JSON.parse(e.data));break;case"ping":this._sendPacket("pong"),this.emitReserved("ping"),this.emitReserved("pong"),this._resetPingTimeout();break;case"error":let t=new Error("server error");t.code=e.data,this._onError(t);break;case"message":this.emitReserved("data",e.data),this.emitReserved("message",e.data);break}}onHandshake(e){this.emitReserved("handshake",e),this.id=e.sid,this.transport.query.sid=e.sid,this._pingInterval=e.pingInterval,this._pingTimeout=e.pingTimeout,this._maxPayload=e.maxPayload,this.onOpen(),this.readyState!=="closed"&&this._resetPingTimeout()}_resetPingTimeout(){this.clearTimeoutFn(this._pingTimeoutTimer);let e=this._pingInterval+this._pingTimeout;this._pingTimeoutTime=Date.now()+e,this._pingTimeoutTimer=this.setTimeoutFn(()=>{this._onClose("ping timeout")},e),this.opts.autoUnref&&this._pingTimeoutTimer.unref()}_onDrain(){this.writeBuffer.splice(0,this._prevBufferLen),this._prevBufferLen=0,this.writeBuffer.length===0?this.emitReserved("drain"):this.flush()}flush(){if(this.readyState!=="closed"&&this.transport.writable&&!this.upgrading&&this.writeBuffer.length){let e=this._getWritablePackets();this.transport.send(e),this._prevBufferLen=e.length,this.emitReserved("flush")}}_getWritablePackets(){if(!(this._maxPayload&&this.transport.name==="polling"&&this.writeBuffer.length>1))return this.writeBuffer;let t=1;for(let r=0;r<this.writeBuffer.length;r++){let i=this.writeBuffer[r].data;if(i&&(t+=xe(i)),r>0&&t>this._maxPayload)return this.writeBuffer.slice(0,r);t+=2}return this.writeBuffer}_hasPingExpired(){if(!this._pingTimeoutTime)return!0;let e=Date.now()>this._pingTimeoutTime;return e&&(this._pingTimeoutTime=0,y(()=>{this._onClose("ping timeout")},this.setTimeoutFn)),e}write(e,t,r){return this._sendPacket("message",e,t,r),this}send(e,t,r){return this._sendPacket("message",e,t,r),this}_sendPacket(e,t,r,i){if(typeof t=="function"&&(i=t,t=void 0),typeof r=="function"&&(i=r,r=null),this.readyState==="closing"||this.readyState==="closed")return;r=r||{},r.compress=r.compress!==!1;let n={type:e,data:t,options:r};this.emitReserved("packetCreate",n),this.writeBuffer.push(n),i&&this.once("flush",i),this.flush()}close(){let e=()=>{this._onClose("forced close"),this.transport.close()},t=()=>{this.off("upgrade",t),this.off("upgradeError",t),e()},r=()=>{this.once("upgrade",t),this.once("upgradeError",t)};return(this.readyState==="opening"||this.readyState==="open")&&(this.readyState="closing",this.writeBuffer.length?this.once("drain",()=>{this.upgrading?r():e()}):this.upgrading?r():e()),this}_onError(e){if(s.priorWebsocketSuccess=!1,this.opts.tryAllTransports&&this.transports.length>1&&this.readyState==="opening")return this.transports.shift(),this._open();this.emitReserved("error",e),this._onClose("transport error",e)}_onClose(e,t){if(this.readyState==="opening"||this.readyState==="open"||this.readyState==="closing"){if(this.clearTimeoutFn(this._pingTimeoutTimer),this.transport.removeAllListeners("close"),this.transport.close(),this.transport.removeAllListeners(),se&&(this._beforeunloadEventListener&&removeEventListener("beforeunload",this._beforeunloadEventListener,!1),this._offlineEventListener)){let r=J.indexOf(this._offlineEventListener);r!==-1&&J.splice(r,1)}this.readyState="closed",this.id=null,this.emitReserved("close",e,t),this.writeBuffer=[],this._prevBufferLen=0}}};v.protocol=G;var z=class extends v{constructor(){super(...arguments),this._upgrades=[]}onOpen(){if(super.onOpen(),this.readyState==="open"&&this.opts.upgrade)for(let e=0;e<this._upgrades.length;e++)this._probe(this._upgrades[e])}_probe(e){let t=this.createTransport(e),r=!1;v.priorWebsocketSuccess=!1;let i=()=>{r||(t.send([{type:"ping",data:"probe"}]),t.once("packet",b=>{if(!r)if(b.type==="pong"&&b.data==="probe"){if(this.upgrading=!0,this.emitReserved("upgrading",t),!t)return;v.priorWebsocketSuccess=t.name==="websocket",this.transport.pause(()=>{r||this.readyState!=="closed"&&(p(),this.setTransport(t),t.send([{type:"upgrade"}]),this.emitReserved("upgrade",t),t=null,this.upgrading=!1,this.flush())})}else{let C=new Error("probe error");C.transport=t.name,this.emitReserved("upgradeError",C)}}))};function n(){r||(r=!0,p(),t.close(),t=null)}let o=b=>{let C=new Error("probe error: "+b);C.transport=t.name,n(),this.emitReserved("upgradeError",C)};function c(){o("transport closed")}function h(){o("socket closed")}function m(b){t&&b.name!==t.name&&n()}let p=()=>{t.removeListener("open",i),t.removeListener("error",o),t.removeListener("close",c),this.off("close",h),this.off("upgrading",m)};t.once("open",i),t.once("error",o),t.once("close",c),this.once("close",h),this.once("upgrading",m),this._upgrades.indexOf("webtransport")!==-1&&e!=="webtransport"?this.setTimeoutFn(()=>{r||t.open()},200):t.open()}onHandshake(e){this._upgrades=this._filterUpgrades(e.upgrades),super.onHandshake(e)}_filterUpgrades(e){let t=[];for(let r=0;r<e.length;r++)~this.transports.indexOf(e[r])&&t.push(e[r]);return t}},R=class extends z{constructor(e,t={}){let r=typeof e=="object",i=r?{...e}:{...t};(!i.transports||i.transports&&typeof i.transports[0]=="string")&&(i.transports=(i.transports||["polling","websocket","webtransport"]).map(n=>te[n]).filter(n=>!!n)),super(r?i:e,i)}};var ms=R.protocol;function Ne(s,e="",t){let r=s;t=t||typeof location!="undefined"&&location,s==null&&(s=t.protocol+"//"+t.host),typeof s=="string"&&(s.charAt(0)==="/"&&(s.charAt(1)==="/"?s=t.protocol+s:s=t.host+s),/^(https?|wss?):\/\//.test(s)||(typeof t!="undefined"?s=t.protocol+"//"+s:s="https://"+s),r=A(s)),r.port||(/^(http|ws)$/.test(r.protocol)?r.port="80":/^(http|ws)s$/.test(r.protocol)&&(r.port="443")),r.path=r.path||"/";let n=r.host.indexOf(":")!==-1?"["+r.host+"]":r.host;return r.id=r.protocol+"://"+n+":"+r.port+e,r.href=r.protocol+"://"+n+(t&&t.port===r.port?"":":"+r.port),r}var ce={};Ve(ce,{Decoder:()=>oe,Encoder:()=>ne,PacketType:()=>a,isPacketValid:()=>ct,protocol:()=>Ie});var tt=typeof ArrayBuffer=="function",st=s=>typeof ArrayBuffer.isView=="function"?ArrayBuffer.isView(s):s.buffer instanceof ArrayBuffer,Le=Object.prototype.toString,rt=typeof Blob=="function"||typeof Blob!="undefined"&&Le.call(Blob)==="[object BlobConstructor]",it=typeof File=="function"||typeof File!="undefined"&&Le.call(File)==="[object FileConstructor]";function F(s){return tt&&(s instanceof ArrayBuffer||st(s))||rt&&s instanceof Blob||it&&s instanceof File}function I(s,e){if(!s||typeof s!="object")return!1;if(Array.isArray(s)){for(let t=0,r=s.length;t<r;t++)if(I(s[t]))return!0;return!1}if(F(s))return!0;if(s.toJSON&&typeof s.toJSON=="function"&&arguments.length===1)return I(s.toJSON(),!0);for(let t in s)if(Object.prototype.hasOwnProperty.call(s,t)&&I(s[t]))return!0;return!1}function Pe(s){let e=[],t=s.data,r=s;return r.data=re(t,e),r.attachments=e.length,{packet:r,buffers:e}}function re(s,e){if(!s)return s;if(F(s)){let t={_placeholder:!0,num:e.length};return e.push(s),t}else if(Array.isArray(s)){let t=new Array(s.length);for(let r=0;r<s.length;r++)t[r]=re(s[r],e);return t}else if(typeof s=="object"&&!(s instanceof Date)){let t={};for(let r in s)Object.prototype.hasOwnProperty.call(s,r)&&(t[r]=re(s[r],e));return t}return s}function qe(s,e){return s.data=ie(s.data,e),delete s.attachments,s}function ie(s,e){if(!s)return s;if(s&&s._placeholder===!0){if(typeof s.num=="number"&&s.num>=0&&s.num<e.length)return e[s.num];throw new Error("illegal attachments")}else if(Array.isArray(s))for(let t=0;t<s.length;t++)s[t]=ie(s[t],e);else if(typeof s=="object")for(let t in s)Object.prototype.hasOwnProperty.call(s,t)&&(s[t]=ie(s[t],e));return s}var De=["connect","connect_error","disconnect","disconnecting","newListener","removeListener"],Ie=5,a;(function(s){s[s.CONNECT=0]="CONNECT",s[s.DISCONNECT=1]="DISCONNECT",s[s.EVENT=2]="EVENT",s[s.ACK=3]="ACK",s[s.CONNECT_ERROR=4]="CONNECT_ERROR",s[s.BINARY_EVENT=5]="BINARY_EVENT",s[s.BINARY_ACK=6]="BINARY_ACK"})(a||(a={}));var ne=class{constructor(e){this.replacer=e}encode(e){return(e.type===a.EVENT||e.type===a.ACK)&&I(e)?this.encodeAsBinary({type:e.type===a.EVENT?a.BINARY_EVENT:a.BINARY_ACK,nsp:e.nsp,data:e.data,id:e.id}):[this.encodeAsString(e)]}encodeAsString(e){let t=""+e.type;return(e.type===a.BINARY_EVENT||e.type===a.BINARY_ACK)&&(t+=e.attachments+"-"),e.nsp&&e.nsp!=="/"&&(t+=e.nsp+","),e.id!=null&&(t+=e.id),e.data!=null&&(t+=JSON.stringify(e.data,this.replacer)),t}encodeAsBinary(e){let t=Pe(e),r=this.encodeAsString(t.packet),i=t.buffers;return i.unshift(r),i}},oe=class s extends f{constructor(e){super(),this.opts=Object.assign({reviver:void 0,maxAttachments:10},typeof e=="function"?{reviver:e}:e)}add(e){let t;if(typeof e=="string"){if(this.reconstructor)throw new Error("got plaintext data when reconstructing a packet");t=this.decodeString(e);let r=t.type===a.BINARY_EVENT;r||t.type===a.BINARY_ACK?(t.type=r?a.EVENT:a.ACK,this.reconstructor=new ae(t),t.attachments===0&&super.emitReserved("decoded",t)):super.emitReserved("decoded",t)}else if(F(e)||e.base64)if(this.reconstructor)t=this.reconstructor.takeBinaryData(e),t&&(this.reconstructor=null,super.emitReserved("decoded",t));else throw new Error("got binary data when not reconstructing a packet");else throw new Error("Unknown type: "+e)}decodeString(e){let t=0,r={type:Number(e.charAt(0))};if(a[r.type]===void 0)throw new Error("unknown packet type "+r.type);if(r.type===a.BINARY_EVENT||r.type===a.BINARY_ACK){let n=t+1;for(;e.charAt(++t)!=="-"&&t!=e.length;);let o=e.substring(n,t);if(o!=Number(o)||e.charAt(t)!=="-")throw new Error("Illegal attachments");let c=Number(o);if(!Fe(c)||c<0)throw new Error("Illegal attachments");if(c>this.opts.maxAttachments)throw new Error("too many attachments");r.attachments=c}if(e.charAt(t+1)==="/"){let n=t+1;for(;++t&&!(e.charAt(t)===","||t===e.length););r.nsp=e.substring(n,t)}else r.nsp="/";let i=e.charAt(t+1);if(i!==""&&Number(i)==i){let n=t+1;for(;++t;){let o=e.charAt(t);if(o==null||Number(o)!=o){--t;break}if(t===e.length)break}r.id=Number(e.substring(n,t+1))}if(e.charAt(++t)){let n=this.tryParse(e.substr(t));if(s.isPayloadValid(r.type,n))r.data=n;else throw new Error("invalid payload")}return r}tryParse(e){try{return JSON.parse(e,this.opts.reviver)}catch(t){return!1}}static isPayloadValid(e,t){switch(e){case a.CONNECT:return X(t);case a.DISCONNECT:return t===void 0;case a.CONNECT_ERROR:return typeof t=="string"||X(t);case a.EVENT:case a.BINARY_EVENT:return Array.isArray(t)&&(typeof t[0]=="number"||typeof t[0]=="string"&&De.indexOf(t[0])===-1);case a.ACK:case a.BINARY_ACK:return Array.isArray(t)}}destroy(){this.reconstructor&&(this.reconstructor.finishedReconstruction(),this.reconstructor=null)}},ae=class{constructor(e){this.packet=e,this.buffers=[],this.reconPack=e}takeBinaryData(e){if(this.buffers.push(e),this.buffers.length===this.reconPack.attachments){let t=qe(this.reconPack,this.buffers);return this.finishedReconstruction(),t}return null}finishedReconstruction(){this.reconPack=null,this.buffers=[]}};function nt(s){return typeof s=="string"}var Fe=Number.isInteger||function(s){return typeof s=="number"&&isFinite(s)&&Math.floor(s)===s};function ot(s){return s===void 0||Fe(s)}function X(s){return Object.prototype.toString.call(s)==="[object Object]"}function at(s,e){switch(s){case a.CONNECT:return e===void 0||X(e);case a.DISCONNECT:return e===void 0;case a.EVENT:return Array.isArray(e)&&(typeof e[0]=="number"||typeof e[0]=="string"&&De.indexOf(e[0])===-1);case a.ACK:return Array.isArray(e);case a.CONNECT_ERROR:return typeof e=="string"||X(e);default:return!1}}function ct(s){return nt(s.nsp)&&ot(s.id)&&at(s.type,s.data)}function l(s,e,t){return s.on(e,t),function(){s.off(e,t)}}var ht=Object.freeze({connect:1,connect_error:1,disconnect:1,disconnecting:1,newListener:1,removeListener:1}),O=class extends f{constructor(e,t,r){super(),this.connected=!1,this.recovered=!1,this.receiveBuffer=[],this.sendBuffer=[],this._queue=[],this._queueSeq=0,this.ids=0,this.acks={},this.flags={},this.io=e,this.nsp=t,r&&r.auth&&(this.auth=r.auth),this._opts=Object.assign({},r),this.io._autoConnect&&this.open()}get disconnected(){return!this.connected}subEvents(){if(this.subs)return;let e=this.io;this.subs=[l(e,"open",this.onopen.bind(this)),l(e,"packet",this.onpacket.bind(this)),l(e,"error",this.onerror.bind(this)),l(e,"close",this.onclose.bind(this))]}get active(){return!!this.subs}connect(){return this.connected?this:(this.subEvents(),this.io._reconnecting||this.io.open(),this.io._readyState==="open"&&this.onopen(),this)}open(){return this.connect()}send(...e){return e.unshift("message"),this.emit.apply(this,e),this}emit(e,...t){var r,i,n;if(ht.hasOwnProperty(e))throw new Error('"'+e.toString()+'" is a reserved event name');if(t.unshift(e),this._opts.retries&&!this.flags.fromQueue&&!this.flags.volatile)return this._addToQueue(t),this;let o={type:a.EVENT,data:t};if(o.options={},o.options.compress=this.flags.compress!==!1,typeof t[t.length-1]=="function"){let p=this.ids++,b=t.pop();this._registerAckCallback(p,b),o.id=p}let c=(i=(r=this.io.engine)===null||r===void 0?void 0:r.transport)===null||i===void 0?void 0:i.writable,h=this.connected&&!(!((n=this.io.engine)===null||n===void 0)&&n._hasPingExpired());return this.flags.volatile&&!c||(h?(this.notifyOutgoingListeners(o),this.packet(o)):this.sendBuffer.push(o)),this.flags={},this}_registerAckCallback(e,t){var r;let i=(r=this.flags.timeout)!==null&&r!==void 0?r:this._opts.ackTimeout;if(i===void 0){this.acks[e]=t;return}let n=this.io.setTimeoutFn(()=>{delete this.acks[e];for(let c=0;c<this.sendBuffer.length;c++)this.sendBuffer[c].id===e&&this.sendBuffer.splice(c,1);t.call(this,new Error("operation has timed out"))},i),o=(...c)=>{this.io.clearTimeoutFn(n),t.apply(this,c)};o.withError=!0,this.acks[e]=o}emitWithAck(e,...t){return new Promise((r,i)=>{let n=(o,c)=>o?i(o):r(c);n.withError=!0,t.push(n),this.emit(e,...t)})}_addToQueue(e){let t;typeof e[e.length-1]=="function"&&(t=e.pop());let r={id:this._queueSeq++,tryCount:0,pending:!1,args:e,flags:Object.assign({fromQueue:!0},this.flags)};e.push((i,...n)=>r!==this._queue[0]?void 0:(i!==null?r.tryCount>this._opts.retries&&(this._queue.shift(),t&&t(i)):(this._queue.shift(),t&&t(null,...n)),r.pending=!1,this._drainQueue())),this._queue.push(r),this._drainQueue()}_drainQueue(e=!1){if(!this.connected||this._queue.length===0)return;let t=this._queue[0];t.pending&&!e||(t.pending=!0,t.tryCount++,this.flags=t.flags,this.emit.apply(this,t.args))}packet(e){e.nsp=this.nsp,this.io._packet(e)}onopen(){typeof this.auth=="function"?this.auth(e=>{this._sendConnectPacket(e)}):this._sendConnectPacket(this.auth)}_sendConnectPacket(e){this.packet({type:a.CONNECT,data:this._pid?Object.assign({pid:this._pid,offset:this._lastOffset},e):e})}onerror(e){this.connected||this.emitReserved("connect_error",e)}onclose(e,t){this.connected=!1,delete this.id,this.emitReserved("disconnect",e,t),this._clearAcks()}_clearAcks(){Object.keys(this.acks).forEach(e=>{if(!this.sendBuffer.some(r=>String(r.id)===e)){let r=this.acks[e];delete this.acks[e],r.withError&&r.call(this,new Error("socket has been disconnected"))}})}onpacket(e){if(e.nsp===this.nsp)switch(e.type){case a.CONNECT:e.data&&e.data.sid?this.onconnect(e.data.sid,e.data.pid):this.emitReserved("connect_error",new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));break;case a.EVENT:case a.BINARY_EVENT:this.onevent(e);break;case a.ACK:case a.BINARY_ACK:this.onack(e);break;case a.DISCONNECT:this.ondisconnect();break;case a.CONNECT_ERROR:this.destroy();let r=new Error(e.data.message);r.data=e.data.data,this.emitReserved("connect_error",r);break}}onevent(e){let t=e.data||[];e.id!=null&&t.push(this.ack(e.id)),this.connected?this.emitEvent(t):this.receiveBuffer.push(Object.freeze(t))}emitEvent(e){if(this._anyListeners&&this._anyListeners.length){let t=this._anyListeners.slice();for(let r of t)r.apply(this,e)}super.emit.apply(this,e),this._pid&&e.length&&typeof e[e.length-1]=="string"&&(this._lastOffset=e[e.length-1])}ack(e){let t=this,r=!1;return function(...i){r||(r=!0,t.packet({type:a.ACK,id:e,data:i}))}}onack(e){let t=this.acks[e.id];typeof t=="function"&&(delete this.acks[e.id],t.withError&&e.data.unshift(null),t.apply(this,e.data))}onconnect(e,t){this.id=e,this.recovered=t&&this._pid===t,this._pid=t,this.connected=!0,this.emitBuffered(),this.emitReserved("connect"),this._drainQueue(!0)}emitBuffered(){this.receiveBuffer.forEach(e=>this.emitEvent(e)),this.receiveBuffer=[],this.sendBuffer.forEach(e=>{this.notifyOutgoingListeners(e),this.packet(e)}),this.sendBuffer=[]}ondisconnect(){this.destroy(),this.onclose("io server disconnect")}destroy(){this.subs&&(this.subs.forEach(e=>e()),this.subs=void 0),this.io._destroy(this)}disconnect(){return this.connected&&this.packet({type:a.DISCONNECT}),this.destroy(),this.connected&&this.onclose("io client disconnect"),this}close(){return this.disconnect()}compress(e){return this.flags.compress=e,this}get volatile(){return this.flags.volatile=!0,this}timeout(e){return this.flags.timeout=e,this}onAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.push(e),this}prependAny(e){return this._anyListeners=this._anyListeners||[],this._anyListeners.unshift(e),this}offAny(e){if(!this._anyListeners)return this;if(e){let t=this._anyListeners;for(let r=0;r<t.length;r++)if(e===t[r])return t.splice(r,1),this}else this._anyListeners=[];return this}listenersAny(){return this._anyListeners||[]}onAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.push(e),this}prependAnyOutgoing(e){return this._anyOutgoingListeners=this._anyOutgoingListeners||[],this._anyOutgoingListeners.unshift(e),this}offAnyOutgoing(e){if(!this._anyOutgoingListeners)return this;if(e){let t=this._anyOutgoingListeners;for(let r=0;r<t.length;r++)if(e===t[r])return t.splice(r,1),this}else this._anyOutgoingListeners=[];return this}listenersAnyOutgoing(){return this._anyOutgoingListeners||[]}notifyOutgoingListeners(e){if(this._anyOutgoingListeners&&this._anyOutgoingListeners.length){let t=this._anyOutgoingListeners.slice();for(let r of t)r.apply(this,e.data)}}};function x(s){s=s||{},this.ms=s.min||100,this.max=s.max||1e4,this.factor=s.factor||2,this.jitter=s.jitter>0&&s.jitter<=1?s.jitter:0,this.attempts=0}x.prototype.duration=function(){var s=this.ms*Math.pow(this.factor,this.attempts++);if(this.jitter){var e=Math.random(),t=Math.floor(e*this.jitter*s);s=(Math.floor(e*10)&1)==0?s-t:s+t}return Math.min(s,this.max)|0};x.prototype.reset=function(){this.attempts=0};x.prototype.setMin=function(s){this.ms=s};x.prototype.setMax=function(s){this.max=s};x.prototype.setJitter=function(s){this.jitter=s};var S=class extends f{constructor(e,t){var r;super(),this.nsps={},this.subs=[],e&&typeof e=="object"&&(t=e,e=void 0),t=t||{},t.path=t.path||"/socket.io",this.opts=t,g(this,t),this.reconnection(t.reconnection!==!1),this.reconnectionAttempts(t.reconnectionAttempts||1/0),this.reconnectionDelay(t.reconnectionDelay||1e3),this.reconnectionDelayMax(t.reconnectionDelayMax||5e3),this.randomizationFactor((r=t.randomizationFactor)!==null&&r!==void 0?r:.5),this.backoff=new x({min:this.reconnectionDelay(),max:this.reconnectionDelayMax(),jitter:this.randomizationFactor()}),this.timeout(t.timeout==null?2e4:t.timeout),this._readyState="closed",this.uri=e;let i=t.parser||ce;this.encoder=new i.Encoder,this.decoder=new i.Decoder,this._autoConnect=t.autoConnect!==!1,this._autoConnect&&this.open()}reconnection(e){return arguments.length?(this._reconnection=!!e,e||(this.skipReconnect=!0),this):this._reconnection}reconnectionAttempts(e){return e===void 0?this._reconnectionAttempts:(this._reconnectionAttempts=e,this)}reconnectionDelay(e){var t;return e===void 0?this._reconnectionDelay:(this._reconnectionDelay=e,(t=this.backoff)===null||t===void 0||t.setMin(e),this)}randomizationFactor(e){var t;return e===void 0?this._randomizationFactor:(this._randomizationFactor=e,(t=this.backoff)===null||t===void 0||t.setJitter(e),this)}reconnectionDelayMax(e){var t;return e===void 0?this._reconnectionDelayMax:(this._reconnectionDelayMax=e,(t=this.backoff)===null||t===void 0||t.setMax(e),this)}timeout(e){return arguments.length?(this._timeout=e,this):this._timeout}maybeReconnectOnOpen(){!this._reconnecting&&this._reconnection&&this.backoff.attempts===0&&this.reconnect()}open(e){if(~this._readyState.indexOf("open"))return this;this.engine=new R(this.uri,this.opts);let t=this.engine,r=this;this._readyState="opening",this.skipReconnect=!1;let i=l(t,"open",function(){r.onopen(),e&&e()}),n=c=>{this.cleanup(),this._readyState="closed",this.emitReserved("error",c),e?e(c):this.maybeReconnectOnOpen()},o=l(t,"error",n);if(this._timeout!==!1){let c=this._timeout,h=this.setTimeoutFn(()=>{i(),n(new Error("timeout")),t.close()},c);this.opts.autoUnref&&h.unref(),this.subs.push(()=>{this.clearTimeoutFn(h)})}return this.subs.push(i),this.subs.push(o),this}connect(e){return this.open(e)}onopen(){this.cleanup(),this._readyState="open",this.emitReserved("open");let e=this.engine;this.subs.push(l(e,"ping",this.onping.bind(this)),l(e,"data",this.ondata.bind(this)),l(e,"error",this.onerror.bind(this)),l(e,"close",this.onclose.bind(this)),l(this.decoder,"decoded",this.ondecoded.bind(this)))}onping(){this.emitReserved("ping")}ondata(e){try{this.decoder.add(e)}catch(t){this.onclose("parse error",t)}}ondecoded(e){y(()=>{this.emitReserved("packet",e)},this.setTimeoutFn)}onerror(e){this.emitReserved("error",e)}socket(e,t){let r=this.nsps[e];return r?this._autoConnect&&!r.active&&r.connect():(r=new O(this,e,t),this.nsps[e]=r),r}_destroy(e){let t=Object.keys(this.nsps);for(let r of t)if(this.nsps[r].active)return;this._close()}_packet(e){let t=this.encoder.encode(e);for(let r=0;r<t.length;r++)this.engine.write(t[r],e.options)}cleanup(){this.subs.forEach(e=>e()),this.subs.length=0,this.decoder.destroy()}_close(){this.skipReconnect=!0,this._reconnecting=!1,this.onclose("forced close")}disconnect(){return this._close()}onclose(e,t){var r;this.cleanup(),(r=this.engine)===null||r===void 0||r.close(),this.backoff.reset(),this._readyState="closed",this.emitReserved("close",e,t),this._reconnection&&!this.skipReconnect&&this.reconnect()}reconnect(){if(this._reconnecting||this.skipReconnect)return this;let e=this;if(this.backoff.attempts>=this._reconnectionAttempts)this.backoff.reset(),this.emitReserved("reconnect_failed"),this._reconnecting=!1;else{let t=this.backoff.duration();this._reconnecting=!0;let r=this.setTimeoutFn(()=>{e.skipReconnect||(this.emitReserved("reconnect_attempt",e.backoff.attempts),!e.skipReconnect&&e.open(i=>{i?(e._reconnecting=!1,e.reconnect(),this.emitReserved("reconnect_error",i)):e.onreconnect()}))},t);this.opts.autoUnref&&r.unref(),this.subs.push(()=>{this.clearTimeoutFn(r)})}}onreconnect(){let e=this.backoff.attempts;this._reconnecting=!1,this.backoff.reset(),this.emitReserved("reconnect",e)}};var U={};function V(s,e){typeof s=="object"&&(e=s,s=void 0),e=e||{};let t=Ne(s,e.path||"/socket.io"),r=t.source,i=t.id,n=t.path,o=U[i]&&n in U[i].nsps,c=e.forceNew||e["force new connection"]||e.multiplex===!1||o,h;return c?h=new S(r,e):(U[i]||(U[i]=new S(r,e)),h=U[i]),t.query&&!e.query&&(e.query=t.queryKey),h.socket(t.path,e)}Object.assign(V,{Manager:S,Socket:O,io:V,connect:V});window.__recopyfastSocketIO={io:V};})();

(function(){"use strict";var de=document.currentScript&&document.currentScript.src||"";(function(){var T=document.currentScript;function e(){if(!T||!T.src)return null;try{var a=new URL(T.src);return a.origin+"/api"}catch(r){return null}}function t(){if(!T||!T.src)return null;try{var a=new URL(T.src);return a.hostname==="localhost"&&a.port==="3000"&&(a.port="4001"),a.origin}catch(r){return null}}if(!window.RECOPYFAST_API){var n=T&&T.getAttribute("data-api-url");n?window.RECOPYFAST_API=n:e()?window.RECOPYFAST_API=e():console.warn("ReCopyFast: RECOPYFAST_API is not set. Add a data-api-url attribute to the script tag or set window.RECOPYFAST_API before loading this script.")}if(!window.RECOPYFAST_WS){var o=T&&T.getAttribute("data-ws-url");o?window.RECOPYFAST_WS=o:t()?window.RECOPYFAST_WS=t():console.warn("ReCopyFast: RECOPYFAST_WS is not set. Add a data-ws-url attribute to the script tag or set window.RECOPYFAST_WS before loading this script.")}})();const H=window.RECOPYFAST_API,xe=window.RECOPYFAST_WS,re=(function(){if(!de)return null;try{const T=new URL(de);return T.search="",T.hash="",T.pathname=T.pathname.replace(/[^/]*$/,"socket.io-client.min.js"),T.href}catch(T){return null}})();function pe(){return window.__recopyfastSocketIO&&typeof window.__recopyfastSocketIO.io=="function"?window.__recopyfastSocketIO.io:typeof window.io=="function"?window.io:null}const D=document.currentScript.getAttribute("data-site-id"),te=document.currentScript.getAttribute("data-site-token"),ie=new URLSearchParams(window.location.search),ue=ie.get("rcf_staging")==="1",se=ie.get("rcf_token"),ce=ie.get("rcf_edit_token"),ye=ue&&se||!!ce;if(ue||se||ce){const T=new URLSearchParams(window.location.search);T.delete("rcf_staging"),T.delete("rcf_token"),T.delete("rcf_edit_token");const e=T.toString(),t=window.location.pathname+(e?"?"+e:"")+window.location.hash;history.replaceState(history.state,"",t)}if(!D){console.error("ReCopyFast: No site ID provided");return}if(!te){console.error("ReCopyFast: No site token provided");return}function ke(T){const e=document.createElement("div");return e.textContent=T,e.innerHTML}var fe=(()=>{var T=Object.defineProperty,e=Object.getOwnPropertyDescriptor,t=Object.getOwnPropertyNames,n=Object.prototype.hasOwnProperty,o=(p,h)=>{for(var u in h)T(p,u,{get:h[u],enumerable:!0})},a=(p,h,u,l)=>{if(h&&typeof h=="object"||typeof h=="function")for(let m of t(h))!n.call(p,m)&&m!==u&&T(p,m,{get:()=>h[m],enumerable:!(l=e(h,m))||l.enumerable});return p},r=p=>a(T({},"__esModule",{value:!0}),p),i={};o(i,{AA_LARGE:()=>R,AA_NON_TEXT:()=>_,AA_NORMAL:()=>S,BLACK:()=>b,WHITE:()=>w,assessReadability:()=>J,compositeOver:()=>y,contrastRatio:()=>C,hasMarkupChildren:()=>Q,measureLayoutFloor:()=>Y,parseCssColor:()=>f,pickAffordanceColor:()=>V,readEditableText:()=>q,relativeLuminance:()=>x,requiredContrast:()=>F,resolveAffordances:()=>K,resolveBackdrop:()=>E,solveScrimAlpha:()=>z,whenFontsReady:()=>ee});var s={transparent:{r:0,g:0,b:0,a:0},white:{r:255,g:255,b:255,a:1},black:{r:0,g:0,b:0,a:1},red:{r:255,g:0,b:0,a:1},green:{r:0,g:128,b:0,a:1},blue:{r:0,g:0,b:255,a:1},gray:{r:128,g:128,b:128,a:1},grey:{r:128,g:128,b:128,a:1},silver:{r:192,g:192,b:192,a:1},navy:{r:0,g:0,b:128,a:1},teal:{r:0,g:128,b:128,a:1},olive:{r:128,g:128,b:0,a:1},maroon:{r:128,g:0,b:0,a:1},purple:{r:128,g:0,b:128,a:1},yellow:{r:255,g:255,b:0,a:1},orange:{r:255,g:165,b:0,a:1}};function c(p,h,u){return p<h?h:p>u?u:p}function g(p,h,u){let l=(p%360+360)%360/360,m=c(h,0,1),I=c(u,0,1);if(m===0){let G=Math.round(I*255);return{r:G,g:G,b:G}}let k=I<.5?I*(1+m):I+m-I*m,P=2*I-k,A=G=>{let W=G;return W<0&&(W+=1),W>1&&(W-=1),W<1/6?P+(k-P)*6*W:W<1/2?k:W<2/3?P+(k-P)*(2/3-W)*6:P};return{r:Math.round(A(l+1/3)*255),g:Math.round(A(l)*255),b:Math.round(A(l-1/3)*255)}}function f(p){if(!p)return null;let h=p.trim().toLowerCase();if(!h||h==="none"||h==="currentcolor"||h==="inherit")return null;if(Object.prototype.hasOwnProperty.call(s,h))return{...s[h]};if(h.charAt(0)==="#"){let m=h.slice(1),I=k=>parseInt(k+k,16);return m.length===3||m.length===4?{r:I(m[0]),g:I(m[1]),b:I(m[2]),a:m.length===4?I(m[3])/255:1}:m.length===6||m.length===8?{r:parseInt(m.slice(0,2),16),g:parseInt(m.slice(2,4),16),b:parseInt(m.slice(4,6),16),a:m.length===8?parseInt(m.slice(6,8),16)/255:1}:null}let u=h.match(/^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);if(u){let m=k=>k.endsWith("%")?parseFloat(k)/100*255:parseFloat(k),I=k=>k===void 0?1:k.endsWith("%")?parseFloat(k)/100:parseFloat(k);return{r:c(m(u[1]),0,255),g:c(m(u[2]),0,255),b:c(m(u[3]),0,255),a:c(I(u[4]),0,1)}}let l=h.match(/^hsla?\(\s*([\d.-]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);if(l){let{r:m,g:I,b:k}=g(parseFloat(l[1]),parseFloat(l[2])/100,parseFloat(l[3])/100),P=l[4],A=P===void 0?1:P.endsWith("%")?parseFloat(P)/100:parseFloat(P);return{r:m,g:I,b:k,a:c(A,0,1)}}return null}function y(p,h){return p.a>=1?{...p}:p.a<=0?{...h}:{r:p.r*p.a+h.r*(1-p.a),g:p.g*p.a+h.g*(1-p.a),b:p.b*p.a+h.b*(1-p.a),a:1}}function x(p){let h=[p.r,p.g,p.b].map(u=>{let l=u/255;return l<=.03928?l/12.92:Math.pow((l+.055)/1.055,2.4)});return .2126*h[0]+.7152*h[1]+.0722*h[2]}function C(p,h){let u=x(p),l=x(h),m=Math.max(u,l),I=Math.min(u,l);return(m+.05)/(I+.05)}var b={r:0,g:0,b:0,a:1},w={r:255,g:255,b:255,a:1},M=/^rgba?\(0,\s*0,\s*0,\s*0\)$|^transparent$/i;function v(p){let h=[],u=/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/gi,l;for(;(l=u.exec(p))!==null;){let m=f(l[1]);m&&h.push(m)}return h}function L(p,h){let u=p.children;for(let l=0;l<u.length;l++){let m=u[l];if(m.tagName!=="VIDEO"&&m.tagName!=="CANVAS")continue;let I=h.getComputedStyle(m).position;if(I==="absolute"||I==="fixed")return!0}return!1}function E(p,h=window){let u=[],l=p,m=null,I=null;for(;l&&l.nodeType===1;){let A=h.getComputedStyle(l);m||(A.mixBlendMode&&A.mixBlendMode!=="normal"?m={kind:"unknown",reason:"mix-blend-mode: "+A.mixBlendMode}:A.filter&&A.filter!=="none"?m={kind:"unknown",reason:"filter: "+A.filter}:A.backdropFilter&&A.backdropFilter!=="none"&&(m={kind:"unknown",reason:"backdrop-filter"}));let G=A.backgroundImage;if(G&&G!=="none"){if(/gradient/i.test(G)){let d=v(G);if(d.length){let B=d.map(x);I=[Math.min(...B),Math.max(...B)];let O=d.reduce(($,Z)=>({r:$.r+Z.r,g:$.g+Z.g,b:$.b+Z.b,a:$.a+Z.a}),{r:0,g:0,b:0,a:0}),X=d.length;u.push({r:O.r/X,g:O.g/X,b:O.b/X,a:Math.min(1,O.a/X)})}m||(m={kind:"gradient",reason:"background gradient"})}else m||(m={kind:"image",reason:"background-image"});break}if(L(l,h)&&!m){m={kind:"media",reason:"video/canvas backdrop"};break}let W=A.backgroundColor;if(W&&!M.test(W)){let d=f(W);if(d&&d.a>0){let B=parseFloat(A.opacity),O=!isNaN(B)&&B<1?{...d,a:d.a*B}:d;if(u.push(O),O.a>=1)break}}l=l.parentElement}let k=U(h);for(let A=u.length-1;A>=0;A--)k=y(u[A],k);if(m)return{kind:m.kind,color:k,certain:!1,luminanceRange:I!=null?I:[0,1],reason:m.reason};let P=x(k);return{kind:"solid",color:k,certain:!0,luminanceRange:[P,P],reason:u.length?"composited background-color":"page canvas"}}function U(p){let h=p.document;for(let u of[h.documentElement,h.body]){if(!u)continue;let l=p.getComputedStyle(u).backgroundColor;if(l&&!M.test(l)){let m=f(l);if(m&&m.a>0)return y(m,w)}}return w}var S=4.5,R=3;function F(p,h){return p>=24||h>=700&&p>=18.66?R:S}function z(p,h,u,l=.92){let m=P=>{let A=1/0;for(let G of[b,w]){let W=y({...h,a:P},G);A=Math.min(A,C(p,W))}return A};if(m(l)<u)return null;let I=0,k=l;for(let P=0;P<10;P++){let A=(I+k)/2;m(A)>=u?k=A:I=A}return Math.ceil(k*256)/256}function N(p){return"rgba("+Math.round(p.r)+", "+Math.round(p.g)+", "+Math.round(p.b)+", "+Math.round(p.a*1e3)/1e3+")"}function J(p,h=window){let u=h.getComputedStyle(p),l=E(p,h),m=parseFloat(u.fontSize)||16,I=parseInt(u.fontWeight,10)||400,k=F(m,I),P=u.webkitTextFillColor,A=/text/.test(u.backgroundClip||"")||/text/.test(u.webkitBackgroundClip||""),G=P&&M.test(P)||M.test(u.color);if(A||G)return{ratio:null,required:k,backdrop:l,scrim:null,guaranteed:null,reason:"glyphs are painted by the background (background-clip: text); left untouched"};let W=f(u.color);if(!W)return{ratio:null,required:k,backdrop:l,scrim:null,guaranteed:null,reason:"text colour unreadable from CSS"};let d=W.a<1?y(W,l.color):W,B=$=>{let Z=null;for(let oe of[b,w]){let ae=$(oe);ae!==null&&(!Z||ae<Z.alpha)&&(Z={color:oe,alpha:ae})}return Z};if(l.certain){let $=C(d,l.color);if($>=k)return{ratio:$,required:k,backdrop:l,scrim:null,guaranteed:$,reason:"already legible; nothing changed"};let Z=B(ae=>j(d,ae,l.color,k));if(Z===null)return{ratio:$,required:k,backdrop:l,scrim:null,guaranteed:null,reason:"no scrim can rescue this colour pair"};let oe=y({...Z.color,a:Z.alpha},l.color);return{ratio:$,required:k,backdrop:l,scrim:N({...Z.color,a:Z.alpha}),guaranteed:C(d,oe),reason:"measured "+$.toFixed(2)+":1 below "+k+":1; minimum scrim applied"}}let O=Math.min(C(d,b),C(d,w));if(O>=k)return{ratio:null,required:k,backdrop:l,scrim:null,guaranteed:O,reason:"legible against any backdrop ("+l.reason+"); nothing changed"};let X=B($=>z(d,$,k));return X===null?{ratio:null,required:k,backdrop:l,scrim:null,guaranteed:null,reason:"no scrim can guarantee "+k+":1"}:{ratio:null,required:k,backdrop:l,scrim:N({...X.color,a:X.alpha}),guaranteed:k,reason:l.reason+" is unmeasurable; smallest scrim that guarantees "+k+":1 applied"}}function j(p,h,u,l,m=.92){let I=A=>C(p,y({...h,a:A},u));if(I(m)<l)return null;let k=0,P=m;for(let A=0;A<10;A++){let G=(k+P)/2;I(G)>=l?P=G:k=G}return Math.ceil(P*256)/256}var _=3;function V(p,h,u=_){for(let l of p){let m=f(l);if(m&&C(m,h)>=u)return l}return C(b,h)>=C(w,h)?"#000000":"#ffffff"}function K(p,h=window){let u=E(p,h),l=x(u.color)>.45,m=V(l?["#1d4ed8","#93c5fd"]:["#93c5fd","#1d4ed8"],u.color),I=V(l?["rgba(37, 99, 235, 0.9)","rgba(147, 197, 253, 0.9)"]:["rgba(147, 197, 253, 0.9)","rgba(37, 99, 235, 0.9)"],u.color);return l?{backdropIsLight:!0,caretColor:m,selectionBackground:"rgba(59, 130, 246, 0.28)",selectionColor:"inherit",outlineColor:I,chromeBackground:"rgba(15, 23, 42, 0.92)",chromeText:"#e2e8f0",chromeBorder:"rgba(255, 255, 255, 0.14)"}:{backdropIsLight:!1,caretColor:m,selectionBackground:"rgba(147, 197, 253, 0.38)",selectionColor:"inherit",outlineColor:I,chromeBackground:"rgba(248, 250, 252, 0.94)",chromeText:"#1e293b",chromeBorder:"rgba(15, 23, 42, 0.14)"}}function Y(p,h=window){let u=h.getComputedStyle(p),l=u.display,m=l==="inline"||l==="ruby"||l==="contents";return{minHeight:parseFloat(u.height)||0,inline:m,preservesWhitespace:/^(pre|pre-wrap|break-spaces)$/.test(u.whiteSpace),writingMode:u.writingMode,direction:u.direction}}function q(p,h=window){var u,l;let m=p;if(p.tagName==="INPUT"||p.tagName==="TEXTAREA")return(u=m.value)!=null?u:"";let I=(l=p.textContent)!=null?l:"",k=h.getComputedStyle(p);return/^(pre|pre-wrap|break-spaces)$/.test(k.whiteSpace)?I:I.trim()}function Q(p){for(let h=0;h<p.children.length;h++)if(p.children[h].tagName!=="BR")return!0;return!1}function ee(p=window,h=3e3){let u=p.document.fonts;return!u||u.status==="loaded"?Promise.resolve():Promise.race([u.ready.then(()=>{}),new Promise(l=>p.setTimeout(l,h))])}return r(i)})();fe.UNAVAILABLE&&console.error("ReCopyFast: running unbuilt source \u2014 shared editing rules were never injected. Readability and geometry rules are disabled. Run: npm run build:embed");const ne=fe,me=["image/jpeg","image/png","image/webp","image/gif","image/avif"],ge=10*1024*1024;function ve(T){return me.indexOf(T.type)===-1?"Unsupported format ("+(T.type||"unknown")+"). Use JPEG, PNG, WebP, GIF or AVIF.":T.size>ge?"Image is "+Math.round(T.size/1024/1024)+" MB \u2014 the limit is "+Math.round(ge/1024/1024)+" MB.":null}function he(T,e){const t=window.getComputedStyle(T),n={width:parseFloat(t.width)||0,height:parseFloat(t.height)||0},o=t.objectFit;T.removeAttribute("srcset"),T.removeAttribute("sizes");const a=T.parentElement;a&&a.tagName==="PICTURE"&&Array.prototype.slice.call(a.querySelectorAll("source")).forEach(function(i){i.remove()}),T.src=e;const r=function(){const i=window.getComputedStyle(T),s=parseFloat(i.width)||0,c=parseFloat(i.height)||0;n.width&&n.height&&(Math.abs(s-n.width)>.5||Math.abs(c-n.height)>.5)&&(T.style.width=n.width+"px",T.style.height=n.height+"px",(!o||o==="fill")&&(T.style.objectFit="cover"))};T.complete?r():T.addEventListener("load",r,{once:!0})}class Ce{constructor(){this.elements=new Map,this.socket=null,this.observer=null,this.isInitialized=!1,this.selectedElement=null,this.stagingMode=ye,this.stagingToken=se,this.editSessionToken=ce,this.stagingAccess=null,this.editMode=!1,this.activeTests=[],this.variantAssignments={},this.visitorId=null,this.geoData=null,this.init()}async init(){try{await this.waitForDOM(),this.stagingMode&&(this.stagingToken||this.editSessionToken)?await this.initStagingMode():this.editMode=!1,await ne.whenFontsReady(window),this.scanForContent(),this.stagingMode||(this.initVisitorId(),await this.fetchActiveTests(),await this.bucketVisitor(),this.applyVariants(),this.setupClickTracking(),this.trackImpressions()),await this.establishConnection(),this.setupMutationObserver(),this.editMode&&this.setupEditMode(),this.isInitialized=!0,console.log("ReCopyFast initialized ("+(this.stagingMode?"staging":"live")+" mode)")}catch(e){console.error("ReCopyFast initialization error:",e)}}async initStagingMode(){try{const e=this.editSessionToken||this.stagingToken,t=e&&e.startsWith("test_"),n=window.location.hostname==="localhost"||window.location.hostname==="127.0.0.1";if(t&&n){console.log("ReCopyFast: Demo mode enabled (test token on localhost)"),this.stagingAccess={verified:!0,email:"demo@recopyfast.local",permissions:["view","edit","publish","admin"],expiresAt:new Date(Date.now()+1440*60*1e3).toISOString()},this.editMode=!0,this.showStagingBanner();return}const a=await(await fetch(H+"/staging/validate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:this.stagingToken||void 0,editToken:this.editSessionToken||void 0,siteId:D})})).json();if(!a.valid){this.showStagingError("Invalid or expired staging link.");return}if(a.requiresEmail){await this.showEmailCaptureUI();return}if(a.requiresVerification){await this.showVerificationUI(a.email);return}this.stagingAccess={kind:a.kind||(this.editSessionToken?"edit-session":"staging"),verified:!0,email:a.email,permissions:a.permissions,expiresAt:a.expiresAt};const r=a.permissions.includes("edit")||a.permissions.includes("publish")||a.permissions.includes("admin");this.editMode=r,this.showStagingBanner()}catch(e){console.error("Staging validation error:",e),this.showStagingError("Failed to validate staging access.")}}showEmailCaptureUI(){return new Promise(e=>{const t=this.createOverlay(),n=document.createElement("div");n.className="rcf-modal";const o=document.createElement("div");o.style.cssText="text-align: center; margin-bottom: 24px;";const a=document.createElement("div");a.className="rcf-modal-icon",a.style.background="linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)",a.style.border="1px solid rgba(59, 130, 246, 0.3)",a.textContent="\u{1F510}";const r=document.createElement("h2");r.className="rcf-modal-title",r.textContent="Staging Access";const i=document.createElement("p");i.className="rcf-modal-subtitle",i.textContent="Enter your email to access the staging environment",o.appendChild(a),o.appendChild(r),o.appendChild(i);const s=document.createElement("div");s.style.cssText="margin-bottom: 24px;";const c=document.createElement("label");c.className="rcf-modal-label",c.textContent="Email Address";const g=document.createElement("input");g.type="email",g.id="rcf-email-input",g.className="rcf-modal-input",g.placeholder="your@email.com";const f=document.createElement("p");f.id="rcf-email-error",f.className="rcf-modal-error",s.appendChild(c),s.appendChild(g),s.appendChild(f);const y=document.createElement("button");y.id="rcf-email-submit",y.className="rcf-modal-btn rcf-modal-btn-primary";const x=document.createElement("span");x.textContent="Continue";const C=document.createElement("span");C.textContent="\u2192",y.appendChild(x),y.appendChild(C),n.appendChild(o),n.appendChild(s),n.appendChild(y),t.appendChild(n),document.body.appendChild(t),g.focus();const b=async()=>{const w=g.value.trim();if(!w||!w.includes("@")){f.textContent="Please enter a valid email address",f.style.display="block";return}y.disabled=!0,y.innerHTML="<span>Sending code...</span>";try{const v=await(await fetch(H+"/staging/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:this.stagingToken,email:w,action:"capture"})})).json();v.success?(document.body.removeChild(t),await this.showVerificationUI(w),e()):(f.textContent=v.error||"Failed to send verification code",f.style.display="block",y.disabled=!1,y.innerHTML="<span>Continue</span><span>\u2192</span>")}catch(M){f.textContent="Network error. Please try again.",f.style.display="block",y.disabled=!1,y.innerHTML="<span>Continue</span><span>\u2192</span>"}};y.onclick=b,g.onkeydown=function(w){w.key==="Enter"&&b()}})}showVerificationUI(e){const t=this;return new Promise(n=>{const o=this.createOverlay(),a=document.createElement("div");a.className="rcf-modal";const r=document.createElement("div");r.style.cssText="text-align: center; margin-bottom: 24px;";const i=document.createElement("div");i.className="rcf-modal-icon",i.style.background="linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)",i.style.border="1px solid rgba(16, 185, 129, 0.3)",i.textContent="\u{1F4E7}";const s=document.createElement("h2");s.className="rcf-modal-title",s.textContent="Check Your Email";const c=document.createElement("p");c.className="rcf-modal-subtitle";const g=document.createElement("strong");g.style.color="#10b981",g.textContent=e,c.appendChild(document.createTextNode("We sent a 6-digit code to ")),c.appendChild(g),r.appendChild(i),r.appendChild(s),r.appendChild(c);const f=document.createElement("div");f.style.cssText="margin-bottom: 24px;";const y=document.createElement("label");y.className="rcf-modal-label",y.textContent="Verification Code";const x=document.createElement("input");x.type="text",x.id="rcf-code-input",x.className="rcf-code-input",x.placeholder="000000",x.maxLength=6;const C=document.createElement("p");C.id="rcf-code-error",C.className="rcf-modal-error",f.appendChild(y),f.appendChild(x),f.appendChild(C);const b=document.createElement("button");b.className="rcf-modal-btn rcf-modal-btn-success",b.style.marginBottom="12px",b.innerHTML="<span>Verify & Continue</span>";const w=document.createElement("button");w.className="rcf-modal-btn rcf-modal-btn-ghost",w.innerHTML="<span>Resend Code</span>",a.appendChild(r),a.appendChild(f),a.appendChild(b),a.appendChild(w),o.appendChild(a),document.body.appendChild(o),x.focus(),x.oninput=function(){x.value=x.value.replace(/[^0-9]/g,"").slice(0,6)};const M=async()=>{const v=x.value.trim();if(v.length!==6){C.textContent="Please enter the 6-digit code",C.style.display="block";return}b.disabled=!0,b.innerHTML="<span>Verifying...</span>";try{const E=await(await fetch(H+"/staging/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t.stagingToken,code:v,action:"verify"})})).json();if(E.success&&E.verified){t.stagingAccess={verified:!0,email:E.email,permissions:E.permissions,expiresAt:E.expiresAt};const U=E.permissions.includes("edit")||E.permissions.includes("publish")||E.permissions.includes("admin");t.editMode=U,document.body.removeChild(o),t.showStagingBanner(),t.editMode&&(t.setupEditMode(),t.elements.forEach(function(S){S.element.classList.add("rcf-editable")})),n()}else C.textContent=E.error||"Invalid verification code",C.style.display="block",b.disabled=!1,b.innerHTML="<span>Verify & Continue</span>"}catch(L){C.textContent="Network error. Please try again.",C.style.display="block",b.disabled=!1,b.innerHTML="<span>Verify & Continue</span>"}};w.onclick=async function(){w.disabled=!0,w.innerHTML="<span>Sending...</span>";try{(await(await fetch(H+"/staging/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:t.stagingToken,action:"resend"})})).json()).success?(w.innerHTML="<span>\u2713 Code Sent!</span>",setTimeout(function(){w.innerHTML="<span>Resend Code</span>",w.disabled=!1},3e3)):(w.innerHTML="<span>Failed - Try Again</span>",w.disabled=!1)}catch(v){w.innerHTML="<span>Failed - Try Again</span>",w.disabled=!1}},b.onclick=M,x.onkeydown=function(v){v.key==="Enter"&&M()}})}showStagingBanner(){if(!this.stagingAccess)return;const e=this,t={eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',board:'<rect x="3" y="3.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M9.5 20.5v-11"/>',publish:'<path d="M12 20V5.5M5.5 12 12 5.5 18.5 12"/>',shield:'<path d="M12 3.2 19 6v5.6c0 4.2-2.9 7.3-7 8.6-4.1-1.3-7-4.4-7-8.6V6l7-2.8Z"/><path d="m9.2 11.8 2.1 2.1 3.5-3.6"/>',clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3 1.8"/>'};function n(v,L){const E=document.createElementNS("http://www.w3.org/2000/svg","svg");return E.setAttribute("viewBox","0 0 24 24"),E.setAttribute("width",L),E.setAttribute("height",L),E.setAttribute("fill","none"),E.setAttribute("stroke","currentColor"),E.setAttribute("stroke-width","1.6"),E.setAttribute("stroke-linecap","round"),E.setAttribute("stroke-linejoin","round"),E.setAttribute("aria-hidden","true"),E.setAttribute("focusable","false"),E.innerHTML=t[v],E}function o(v){const L=document.createElement("span");return L.className="rcf-banner-divider"+(v?" rcf-banner-divider-"+v:""),L.setAttribute("aria-hidden","true"),L}if(!document.querySelector("#rcf-banner-styles")){const v=document.createElement("style");v.id="rcf-banner-styles",v.textContent=`
          #rcf-staging-banner, #rcf-staging-banner * {
            box-sizing: border-box;
          }
          #rcf-staging-banner {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            height: 46px;
            padding: 0 14px;
            background: hsl(200 18% 7% / 0.86);
            backdrop-filter: blur(24px) saturate(180%);
            -webkit-backdrop-filter: blur(24px) saturate(180%);
            border-bottom: 1px solid hsl(200 12% 21%);
            box-shadow: 0 10px 30px -18px rgb(0 0 0 / 0.8);
            color: hsl(200 22% 96%);
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            line-height: 1;
            -webkit-font-smoothing: antialiased;
          }
          .rcf-banner-info {
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }
          .rcf-banner-actions {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
          }
          .rcf-banner-divider {
            width: 1px;
            height: 16px;
            background: hsl(200 12% 24%);
            flex-shrink: 0;
          }
          .rcf-banner-mode {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            flex-shrink: 0;
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: 0.09em;
            text-transform: uppercase;
            color: hsl(38 82% 66%);
          }
          .rcf-status-dot {
            position: relative;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: hsl(38 92% 60%);
            flex-shrink: 0;
          }
          .rcf-status-dot::before {
            content: '';
            position: absolute;
            inset: -1px;
            border-radius: 50%;
            border: 1px solid hsl(38 92% 60%);
            animation: rcf-pulse-ring 2.4s ease-out infinite;
          }
          @keyframes rcf-pulse-ring {
            0% { transform: scale(1); opacity: 0.7; }
            70%, 100% { transform: scale(2.4); opacity: 0; }
          }
          .rcf-banner-email {
            font-size: 12.5px;
            font-weight: 500;
            color: hsl(200 22% 96%);
            max-width: 240px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .rcf-banner-meta {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            flex-shrink: 0;
            font-size: 12px;
            color: hsl(200 12% 68%);
            white-space: nowrap;
          }
          .rcf-banner-meta svg {
            flex-shrink: 0;
            opacity: 0.75;
          }
          .rcf-banner-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 30px;
            margin: 0;
            padding: 0 12px;
            font-family: inherit;
            font-size: 12.5px;
            font-weight: 500;
            line-height: 1;
            letter-spacing: normal;
            text-transform: none;
            text-decoration: none;
            border-radius: 7px;
            cursor: pointer;
            white-space: nowrap;
            transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
          }
          .rcf-banner-btn:focus-visible {
            outline: 2px solid hsl(174 48% 58%);
            outline-offset: 2px;
          }
          .rcf-banner-btn:active {
            transform: translateY(0.5px);
          }
          .rcf-banner-btn-ghost {
            background: hsl(200 14% 13%);
            border: 1px solid hsl(200 12% 24%);
            color: hsl(200 18% 88%);
          }
          .rcf-banner-btn-ghost:hover {
            background: hsl(200 13% 18%);
            border-color: hsl(200 10% 34%);
            color: hsl(200 22% 96%);
          }
          .rcf-banner-btn-primary {
            background: hsl(174 48% 58%);
            border: 1px solid hsl(174 48% 58%);
            color: hsl(200 30% 8%);
            font-weight: 600;
          }
          .rcf-banner-btn-primary:hover {
            background: hsl(174 52% 65%);
            border-color: hsl(174 52% 65%);
          }
          /* Metadata sheds from least to most important as the bar narrows,
             so the actions on the right are never pushed off-screen. */
          @media (max-width: 1000px) {
            .rcf-banner-meta-expiry,
            .rcf-banner-divider-expiry { display: none; }
          }
          @media (max-width: 840px) {
            .rcf-banner-meta-perms,
            .rcf-banner-divider-perms { display: none; }
          }
          @media (max-width: 620px) {
            .rcf-banner-email,
            .rcf-banner-divider-email,
            .rcf-banner-btn-label { display: none; }
            .rcf-banner-btn { padding: 0 9px; }
          }
          @media (prefers-reduced-motion: reduce) {
            .rcf-status-dot::before { animation: none; }
            .rcf-banner-btn { transition: none; }
            .rcf-banner-btn:active { transform: none; }
          }
        `,document.head.appendChild(v)}const a=document.createElement("div");a.id="rcf-staging-banner",a.setAttribute("role","region"),a.setAttribute("aria-label","ReCopyFast staging toolbar");const r=this.stagingAccess.permissions||[],i=r.map(function(v){return v.charAt(0).toUpperCase()+v.slice(1)}).join(", "),s=this.stagingAccess.expiresAt?new Date(this.stagingAccess.expiresAt).toLocaleDateString("en-US",{month:"short",day:"numeric"}):null,c=document.createElement("div");c.className="rcf-banner-info";const g=document.createElement("span");g.className="rcf-banner-mode";const f=document.createElement("span");f.className="rcf-status-dot";const y=document.createElement("span");y.textContent="Staging",g.appendChild(f),g.appendChild(y),c.appendChild(g),c.appendChild(o("email"));const x=document.createElement("span");if(x.className="rcf-banner-email",x.textContent=this.stagingAccess.email,x.title=this.stagingAccess.email,c.appendChild(x),i){c.appendChild(o("perms"));const v=document.createElement("span");v.className="rcf-banner-meta rcf-banner-meta-perms";const L=document.createElement("span");L.textContent=i,v.appendChild(n("shield",13)),v.appendChild(L),c.appendChild(v)}if(s){c.appendChild(o("expiry"));const v=document.createElement("span");v.className="rcf-banner-meta rcf-banner-meta-expiry";const L=document.createElement("span");L.textContent="Expires "+s,v.appendChild(n("clock",13)),v.appendChild(L),c.appendChild(v)}const C=document.createElement("div");C.className="rcf-banner-actions";function b(v,L,E,U){const S=document.createElement("button");S.id=v,S.type="button",S.className="rcf-banner-btn rcf-banner-btn-"+L,S.setAttribute("aria-label",U),S.title=U;const R=document.createElement("span");return R.className="rcf-banner-btn-label",R.textContent=U,S.appendChild(n(E,14)),S.appendChild(R),S}const w=b("rcf-preview-live","ghost","eye","Preview Live");C.appendChild(w);const M=b("rcf-edit-board-btn","ghost","board","Edit Board");if(C.appendChild(M),M.onclick=function(){e.editBoard||(e.editBoard=new we(e)),e.editBoard.open()},r.includes("publish")||r.includes("admin")){const v=b("rcf-publish-btn","primary","publish","Publish");C.appendChild(v),v.onclick=function(){e.showPublishConfirmation()}}a.appendChild(c),a.appendChild(C),document.body.appendChild(a),document.body.style.paddingTop=a.offsetHeight+parseInt(document.body.style.paddingTop||0)+"px",w.onclick=function(){const v=new URL(window.location.href);v.searchParams.delete("rcf_staging"),v.searchParams.delete("rcf_token"),window.open(v.toString(),"_blank")}}async showPublishConfirmation(){const e=this,t=this.createOverlay(),n=document.createElement("div");n.className="rcf-modal";const o=document.createElement("div");o.style.cssText="text-align: center; margin-bottom: 24px;";const a=document.createElement("div");a.className="rcf-modal-icon",a.style.background="linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.2) 100%)",a.style.border="1px solid rgba(16, 185, 129, 0.3)",a.textContent="\u{1F680}";const r=document.createElement("h2");r.className="rcf-modal-title",r.textContent="Publish Changes";const i=document.createElement("p");i.className="rcf-modal-subtitle",i.textContent="This will make your staging changes live on the website.",o.appendChild(a),o.appendChild(r),o.appendChild(i);const s=document.createElement("div");s.id="rcf-publish-status",s.style.cssText="margin-bottom: 24px; padding: 16px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px;";const c=document.createElement("p");c.style.cssText="margin: 0; color: #94a3b8; text-align: center; font-size: 14px;",c.textContent="Loading pending changes...",s.appendChild(c);const g=document.createElement("div");g.style.cssText="display: flex; gap: 12px;";const f=document.createElement("button");f.className="rcf-modal-btn rcf-modal-btn-ghost",f.style.flex="1",f.innerHTML="<span>Cancel</span>";const y=document.createElement("button");y.className="rcf-modal-btn rcf-modal-btn-success",y.style.flex="1",y.innerHTML="<span>\u{1F680}</span><span>Publish Now</span>",g.appendChild(f),g.appendChild(y),n.appendChild(o),n.appendChild(s),n.appendChild(g),t.appendChild(n),document.body.appendChild(t);const x=function(){document.body.contains(t)&&document.body.removeChild(t)};f.onclick=x,t.onclick=function(C){C.target===t&&x()};try{const C=H+"/staging/publish?siteId="+D+(e.editSessionToken?"&rcf_edit_token="+encodeURIComponent(e.editSessionToken):"&rcf_token="+encodeURIComponent(e.stagingToken)),w=await(await fetch(C)).json();w.success&&(w.pendingChanges===0?(c.textContent="\u2705 No pending changes to publish.",y.disabled=!0,y.style.opacity="0.5"):c.textContent="\u{1F4DD} "+w.pendingChanges+" element(s) with changes")}catch(C){c.textContent="Failed to load pending changes.",c.style.color="#ef4444"}y.onclick=async function(){y.disabled=!0,y.innerHTML="<span>Publishing...</span>";try{const b=await(await fetch(H+"/staging/publish",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId:D,stagingToken:e.stagingToken||void 0,editToken:e.editSessionToken||void 0})})).json();b.success?(c.textContent="\u2705 Published "+b.published+" change(s) successfully!",c.style.color="#10b981",y.innerHTML="<span>\u2713 Done!</span>",setTimeout(x,2e3)):(c.textContent=b.error||"Failed to publish changes.",c.style.color="#f87171",y.disabled=!1,y.innerHTML="<span>\u{1F680}</span><span>Publish Now</span>")}catch(C){c.textContent="Network error. Please try again.",c.style.color="#f87171",y.disabled=!1,y.innerHTML="<span>\u{1F680}</span><span>Publish Now</span>"}}}showStagingError(e){const t=this.createOverlay(),n=document.createElement("div");n.className="rcf-modal";const o=document.createElement("div");o.style.cssText="text-align: center;";const a=document.createElement("div");a.className="rcf-modal-icon",a.style.background="linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.2) 100%)",a.style.border="1px solid rgba(239, 68, 68, 0.3)",a.textContent="\u26A0\uFE0F";const r=document.createElement("h2");r.className="rcf-modal-title",r.textContent="Access Denied";const i=document.createElement("p");i.className="rcf-modal-subtitle",i.style.marginBottom="24px",i.textContent=e;const s=document.createElement("button");s.className="rcf-modal-btn rcf-modal-btn-ghost",s.innerHTML="<span>\u2190 Go Back</span>",o.appendChild(a),o.appendChild(r),o.appendChild(i),o.appendChild(s),n.appendChild(o),t.appendChild(n),document.body.appendChild(t),s.onclick=function(){const c=new URL(window.location.href);c.searchParams.delete("rcf_staging"),c.searchParams.delete("rcf_token"),window.location.href=c.toString()}}createOverlay(){const e=document.createElement("div");if(e.className="rcf-overlay",e.style.cssText='position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 100000; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',!document.querySelector("#rcf-modal-styles")){const t=document.createElement("style");t.id="rcf-modal-styles",t.textContent=`
          .rcf-modal {
            background: linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
            border-radius: 20px;
            padding: 32px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0 1px 0 rgba(255, 255, 255, 0.1);
            animation: rcf-modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            color: #e2e8f0;
          }
          @keyframes rcf-modal-in {
            from { opacity: 0; transform: scale(0.95) translateY(20px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          .rcf-modal-input {
            width: 100%;
            padding: 14px 16px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 15px;
            color: #f1f5f9;
            transition: all 0.2s ease;
            box-sizing: border-box;
          }
          .rcf-modal-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
          }
          .rcf-modal-input::placeholder {
            color: rgba(148, 163, 184, 0.6);
          }
          .rcf-modal-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 14px 24px;
            font-size: 15px;
            font-weight: 600;
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            border: none;
            outline: none;
          }
          .rcf-modal-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
          }
          .rcf-modal-btn-primary {
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4);
          }
          .rcf-modal-btn-primary:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5);
          }
          .rcf-modal-btn-success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);
          }
          .rcf-modal-btn-success:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.5);
          }
          .rcf-modal-btn-ghost {
            background: rgba(255, 255, 255, 0.08);
            color: #94a3b8;
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          .rcf-modal-btn-ghost:hover:not(:disabled) {
            background: rgba(255, 255, 255, 0.12);
            color: #e2e8f0;
          }
          .rcf-modal-icon {
            width: 72px;
            height: 72px;
            border-radius: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            font-size: 36px;
          }
          .rcf-modal-title {
            margin: 0 0 8px;
            color: #f1f5f9;
            font-size: 22px;
            font-weight: 600;
          }
          .rcf-modal-subtitle {
            margin: 0;
            color: #94a3b8;
            font-size: 14px;
            line-height: 1.5;
          }
          .rcf-modal-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #cbd5e1;
            font-size: 13px;
          }
          .rcf-modal-error {
            color: #f87171;
            font-size: 12px;
            margin: 8px 0 0;
            display: none;
          }
          .rcf-code-input {
            width: 100%;
            padding: 18px;
            background: rgba(15, 23, 42, 0.6);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            font-size: 28px;
            text-align: center;
            letter-spacing: 12px;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace;
            color: #f1f5f9;
            box-sizing: border-box;
          }
          .rcf-code-input:focus {
            outline: none;
            border-color: #10b981;
            box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
          }
        `,document.head.appendChild(t)}return e}waitForDOM(){return new Promise(function(e){document.readyState==="loading"?document.addEventListener("DOMContentLoaded",e):e()})}queryDeep(e,t,n){const o=n||[],a=t||document;Array.prototype.push.apply(o,Array.prototype.slice.call(a.querySelectorAll(e)));const r=a.querySelectorAll("*");for(let i=0;i<r.length;i++)r[i].shadowRoot&&this.queryDeep(e,r[i].shadowRoot,o);return o}scanForContent(){const e=this;this.queryDeep("h1, h2, h3, h4, h5, h6, p, span, li, td, th, label, button, a.rcf-editable-link, img, div[data-rcf-content]").forEach(function(o,a){if(e.shouldSkipElement(o))return;const i=o.tagName==="IMG"?o.getAttribute("src")||"":e.getElementText(o);if(!i||i.trim().length<2)return;const s=o.getAttribute("data-rcf-id")||"rcf-"+D+"-"+Date.now()+"-"+a;o.setAttribute("data-rcf-id",s),e.elements.set(s,{element:o,originalContent:i,selector:e.generateSelector(o),type:o.tagName.toLowerCase()}),e.editMode&&o.classList.add("rcf-editable")}),console.log("ReCopyFast: Found "+this.elements.size+" editable elements")}shouldSkipElement(e){return["SCRIPT","STYLE","NOSCRIPT","IFRAME","OBJECT","EMBED"].includes(e.tagName)||e.hasAttribute("data-rcf-ignore")||e.closest('[contenteditable="true"]')||e.closest("#rcf-staging-banner")||e.closest("#rcf-edit-board")||e.closest(".rcf-overlay")||e.closest("[data-rcf-ignore]")?!0:e.tagName==="IMG"?e.offsetWidth<48||e.offsetHeight<48:Array.from(e.childNodes).every(function(o){return o.nodeType!==Node.TEXT_NODE||!o.textContent.trim()})&&!e.hasAttribute("data-rcf-content")}getElementText(e){return e.tagName==="INPUT"||e.tagName==="TEXTAREA"?e.value:e.textContent}getFullElementText(e){if(e.tagName==="INPUT"||e.tagName==="TEXTAREA")return(e.value||e.placeholder||"").trim();const t=ne.readEditableText(e);return(t.endsWith("...")||t.endsWith("\u2026"))&&(e.title||e.getAttribute("data-full-text"))||t}assessReadability(e){return ne.assessReadability(e)}getEditingColors(e){return ne.resolveAffordances(e)}getElementEditType(e){const t=e.tagName.toLowerCase(),n=window.getComputedStyle(e);if(t==="img"||t==="picture"||t==="svg"&&e.querySelector("image"))return"image";if(t==="a")return"link";if(["input","textarea","select","button"].includes(t))return"form";const o=n.animationName,a=parseFloat(n.animationDuration)||0,r=o!=="none"&&o!==""&&a>0,i=e.hasAttribute("data-framer-name")||e.hasAttribute("data-framer-component-type")||e.classList.contains("framer-motion"),s=e.hasAttribute("data-gsap")||e._gsap!==void 0;return r||i||s?"animated":["div","section","article","main","aside","header","footer","nav"].includes(t)&&!Array.from(e.childNodes).some(function(g){return g.nodeType===Node.TEXT_NODE&&g.textContent.trim().length>0})&&e.children.length>0?"container":"text"}generateSelector(e){var o;const t=[];let n=e;for(;n&&n!==document.body;){let a=n.tagName.toLowerCase();if(n.id){a="#"+n.id,t.unshift(a);break}if(n.className&&typeof n.className=="string"){const s=n.className.trim().split(/\s+/).filter(function(c){return!c.startsWith("rcf-")});s.length>0&&(a+="."+s.join("."))}const r=Array.from(((o=n.parentNode)==null?void 0:o.children)||[]),i=r.indexOf(n);r.length>1&&(a+=":nth-child("+(i+1)+")"),t.unshift(a),n=n.parentNode}return t.join(" > ")}uploadImage(e,t){return new Promise(function(n,o){const a=new FormData;a.append("file",e),a.append("siteId",D);const r=new XMLHttpRequest;r.open("POST",H+"/upload/image"),r.setRequestHeader("Authorization","Bearer "+te),r.timeout=12e4,r.upload&&typeof t=="function"&&(r.upload.onprogress=function(i){i.lengthComputable&&t(Math.round(i.loaded/i.total*100))}),r.onload=function(){let i={};try{i=JSON.parse(r.responseText||"{}")}catch(s){}if(r.status===200&&i.url){n({url:i.url,width:i.width,height:i.height});return}r.status===401?o(new Error("Not authorised to upload to this site.")):r.status===413?o(new Error("Image is too large for the server.")):r.status===400?o(new Error(i.error||"Server rejected this file.")):r.status===404?o(new Error("Image uploads are not enabled yet for this deployment.")):o(new Error(i.error||"Upload failed (HTTP "+r.status+")."))},r.onerror=function(){o(new Error("Network error during upload."))},r.ontimeout=function(){o(new Error("Upload timed out."))},r.onabort=function(){o(new Error("Upload cancelled."))},r.send(a)})}async persistContentUpdate(e,t,n){if(!this.stagingMode)throw new Error("Live editing requires a staging or edit-session token.");const o=this.editSessionToken?"?rcf_edit_token="+encodeURIComponent(this.editSessionToken):"?rcf_token="+encodeURIComponent(this.stagingToken),a=await fetch(H+"/staging/content/"+D+o,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.assign({elementId:e,content:t,stagingToken:this.stagingToken||void 0,editToken:this.editSessionToken||void 0},n||{}))}),r=await a.json().catch(function(){return{}});if(!a.ok||r.error)throw new Error(r.error||"Failed to save content");return this.emitRealtimeContentUpdate(Object.assign({siteId:D,elementId:e,content:t,token:te,stagingMode:this.stagingMode,stagingToken:this.stagingToken||"",editToken:this.editSessionToken||"",persisted:!0},n||{})),r}emitRealtimeContentUpdate(e){if(!(!this.socket||!this.socket.connected))try{typeof this.socket.timeout=="function"?this.socket.timeout(2e3).emit("content-update",e,function(t,n){(t||n&&n.error)&&console.warn("ReCopyFast: Realtime fanout failed:",t||n.error)}):this.socket.emit("content-update",e,function(t){t&&t.error&&console.warn("ReCopyFast: Realtime fanout failed:",t.error)})}catch(t){console.warn("ReCopyFast: Realtime fanout failed:",t)}}async establishConnection(){const e=this;try{const t=await this.loadSocketIO();this.socket=t(xe,{query:{siteId:D,editMode:this.editMode,token:te,stagingMode:this.stagingMode,stagingToken:this.stagingToken||"",editToken:this.editSessionToken||""},reconnection:!0,reconnectionDelay:1e3,reconnectionAttempts:5}),this.socket.on("connect",function(){console.log("ReCopyFast: Connected to server"),e.sendContentMap()}),this.socket.on("content-update",function(n){e.handleContentUpdate(n)}),this.socket.on("ab-test-update",function(n){e.handleABTestUpdate(n)}),this.socket.on("disconnect",function(){console.log("ReCopyFast: Disconnected from server")}),this.socket.on("error",function(n){console.error("ReCopyFast: Socket error:",n)}),this.socket.on("auth-error",function(n){console.error("ReCopyFast: Auth error:",n.error),e.stagingMode&&e.showStagingError(n.error)})}catch(t){console.error("ReCopyFast: Failed to establish connection:",t),this.startPolling()}}loadSocketIO(){return new Promise(function(e,t){const n=pe();if(n){e(n);return}if(!re){t(new Error("socket.io-client is unavailable and its URL could not be derived from the embed script src"));return}const o=document.createElement("script");o.src=re,o.async=!0,o.crossOrigin="anonymous",o.onload=function(){const a=pe();a?e(a):t(new Error("socket.io-client loaded but exposed no client factory"))},o.onerror=function(){t(new Error("Failed to load socket.io-client from "+re))},document.head.appendChild(o)})}sendContentMap(){if(!this.socket)return;const e={};this.elements.forEach(function(t,n){e[n]={selector:t.selector,content:t.originalContent,type:t.type}}),this.socket.emit("content-map",{siteId:D,url:window.location.href,token:te,stagingMode:this.stagingMode,stagingToken:this.stagingToken,contentMap:e})}initVisitorId(){for(var e=document.cookie.split(";"),t=0;t<e.length;t++){var n=e[t].trim();if(n.indexOf("rcf_vid=")===0){this.visitorId=n.substring(8);return}}typeof crypto!="undefined"&&crypto.randomUUID?this.visitorId=crypto.randomUUID():this.visitorId="rcf-"+Date.now()+"-"+Math.random().toString(36).substring(2,11),document.cookie="rcf_vid="+this.visitorId+"; path=/; max-age=31536000; SameSite=Lax"}async fetchActiveTests(){try{var e=await fetch(H+"/ab-tests/active/"+D+"?token="+encodeURIComponent(te));if(!e.ok)return;var t=await e.json();this.activeTests=t.tests||[]}catch(n){console.log("ReCopyFast: A/B tests unavailable"),this.activeTests=[]}}async bucketVisitor(){if(!(!this.activeTests.length||!this.visitorId)){try{var e=await fetch(H+"/ab-tests/bucket/"+D+"?token="+encodeURIComponent(te)+"&visitor_id="+encodeURIComponent(this.visitorId));if(e.ok){var t=await e.json();this.variantAssignments=t.assignments||{},this.geoData=t.geo||null;return}}catch(o){console.log("ReCopyFast: Using client-side bucketing fallback")}var n=this;this.activeTests.forEach(function(o){if(!n.variantAssignments[o.id]){for(var a=n.fnv1aHash(n.visitorId+":"+o.id),r=a%100,i=0,s=o.variants.filter(function(g){return!0}),c=0;c<s.length;c++)if(i+=s[c].traffic_percentage,r<i){n.variantAssignments[o.id]=s[c].id;break}}})}}fnv1aHash(e){for(var t=2166136261,n=0;n<e.length;n++)t^=e.charCodeAt(n),t=t*16777619>>>0;return t}applyVariants(){var e=this;this.activeTests.forEach(function(t){var n=e.variantAssignments[t.id];if(n){var o=t.variants.find(function(i){return i.id===n});if(o&&!o.is_control){var a=t.target_element_id;if(a){var r=e.elements.get(a);!r||!r.element||(r.element.tagName==="INPUT"||r.element.tagName==="TEXTAREA"?r.element.value=o.variant_content:r.element.textContent=o.variant_content,r.element.setAttribute("data-rcf-test",t.id),r.element.setAttribute("data-rcf-variant",n))}}}})}setupClickTracking(){var e=this;this.activeTests.forEach(function(t){var n=t.target_element_id;if(n){var o=e.elements.get(n);if(!(!o||!o.element)){var a=o.element,r=a;if(a.tagName!=="A"&&a.tagName!=="BUTTON"){var i=a.closest("a, button");i&&(r=i)}r.addEventListener("click",function(){var s=e.variantAssignments[t.id];!s||!e.visitorId||e.sendTrackEvent({site_id:D,test_id:t.id,variant_id:s,visitor_id:e.visitorId,event_type:"click",geo_country:e.geoData?e.geoData.country:null,geo_region:e.geoData?e.geoData.region:null})})}}})}trackImpressions(){var e=this,t=[];this.activeTests.forEach(function(n){var o=e.variantAssignments[n.id];!o||!e.visitorId||t.push({site_id:D,test_id:n.id,variant_id:o,visitor_id:e.visitorId,event_type:"view",geo_country:e.geoData?e.geoData.country:null,geo_region:e.geoData?e.geoData.region:null})}),t.length>0&&this.sendTrackEvent(t)}trackConversion(e,t){var n=this,o=[];this.activeTests.forEach(function(a){var r=n.variantAssignments[a.id];!r||!n.visitorId||o.push({site_id:D,test_id:a.id,variant_id:r,visitor_id:n.visitorId,event_type:"conversion",value:t||1,metadata:{event_name:e},geo_country:n.geoData?n.geoData.country:null,geo_region:n.geoData?n.geoData.region:null})}),o.length>0&&this.sendTrackEvent(o)}sendTrackEvent(e){var t=JSON.stringify(Array.isArray(e)?e:[e]),n=H+"/ab-tests/track?token="+encodeURIComponent(te);if(navigator.sendBeacon){var o=new Blob([t],{type:"application/json"});navigator.sendBeacon(n,o)}else fetch(n,{method:"POST",headers:{"Content-Type":"application/json"},body:t,keepalive:!0}).catch(function(){})}handleABTestUpdate(e){var t=this;e.status==="active"?this.fetchActiveTests().then(function(){return t.bucketVisitor()}).then(function(){t.applyVariants(),t.setupClickTracking(),t.trackImpressions()}):e.status==="completed"&&(t.activeTests=t.activeTests.filter(function(n){return n.id!==e.test_id}),delete t.variantAssignments[e.test_id])}handleContentUpdate(e){const t=e.elementId,n=e.content,o=e.language,a=e.variant;if(o&&o!=="en"||a&&a!=="default")return;const r=this.elements.get(t);if(!r)return;const i=r.element;i.getAttribute("data-rcf-editing")||(i.tagName==="INPUT"||i.tagName==="TEXTAREA"?i.value=n:i.tagName==="IMG"?(he(i,n),e.alt!==void 0&&e.alt!==null&&(i.alt=e.alt)):i.textContent=n,r.element.classList.add("rcf-updated"),setTimeout(function(){r.element.classList.remove("rcf-updated")},300))}setupMutationObserver(){const e=this;this.observer=new MutationObserver(function(t){let n=!1;t.forEach(function(o){o.type==="childList"&&o.addedNodes.length>0&&(n=!0)}),n&&(clearTimeout(e.rescanTimeout),e.rescanTimeout=setTimeout(function(){e.scanForContent(),e.sendContentMap()},500))}),this.observer.observe(document.body,{childList:!0,subtree:!0})}setupEditMode(){if(!this.editMode)return;const e=this;this.injectStyles(),document.addEventListener("click",function(a){const r=a.target.closest("[data-rcf-id]");if(!r)return;switch(a.preventDefault(),a.stopPropagation(),e.getElementEditType(r)){case"image":e.openImageEditor(r);break;case"link":e.startLinkEdit(r);break;case"animated":e.startAnimatedEdit(r);break;case"form":e.startFormEdit(r);break;case"container":e.showContainerHint(r);break;case"text":default:e.startInlineEdit(r);break}});let t=null;const n=function(a){t||(t=document.createElement("div"),t.className="rcf-hover-hint",t.textContent="\u270F\uFE0F Click to edit",t.setAttribute("data-rcf-ignore",""),document.body.appendChild(t)),t.style.display="flex";const r=a.getBoundingClientRect(),i=t.offsetHeight||28,s=t.offsetWidth||120,c=r.top-i-8<4?r.bottom+8:r.top-i-8;let g=r.left+r.width/2-s/2;g=Math.max(8,Math.min(g,window.innerWidth-s-8)),t.style.top=c+"px",t.style.left=g+"px"},o=function(){t&&(t.style.display="none")};document.addEventListener("mouseover",function(a){const r=a.target.closest("[data-rcf-id]");r&&!r.getAttribute("data-rcf-editing")&&(r.classList.add("rcf-hovering"),n(r))}),document.addEventListener("mouseout",function(a){const r=a.target.closest("[data-rcf-id]");r&&(r.classList.remove("rcf-hovering"),o())}),this.hideHoverHint=o}injectStyles(){const e=document.createElement("style");e.textContent=`
        /*
         * Nothing here may participate in layout.
         *
         * The previous version set \`position: relative\` and \`transition: all\`
         * on every editable element the moment edit mode turned on, which moves
         * absolutely-positioned children, creates stacking contexts across the
         * whole page, and animates every property we subsequently touch.
         * Outline, cursor and colour are the only safe affordances: outline is
         * painted outside the box and never reflows anything.
         */
        .rcf-hovering {
          cursor: pointer !important;
          outline: 2px dashed rgba(59, 130, 246, 0.6) !important;
          outline-offset: 4px !important;
        }
        /*
         * The hover hint used to be an ::before/::after on the element itself,
         * which needed \`position: relative\` on every editable element to anchor
         * it. It is now a single fixed-position node positioned from JS, so the
         * page's own layout is never touched.
         */
        .rcf-hover-hint {
          position: fixed;
          display: flex;
          align-items: center;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
          color: #e2e8f0;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 500;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          white-space: nowrap;
          z-index: 9998;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        /*
         * EDIT AFFORDANCE \u2014 layout-neutral by construction.
         *
         * Everything the previous version put here changed layout: min/max
         * width and height taken from getBoundingClientRect (which an ancestor
         * transform has already scaled, so a scale(1.35) parent grew the element
         * by 35% on every edit), \`overflow: hidden\` (establishes a block
         * formatting context, so margins stop collapsing and the page shifts),
         * \`contain: layout style\`, a forced \`white-space\`, and a border-radius
         * override. None of that is needed: contenteditable does not resize an
         * element, so the correct number of geometry properties to set is zero.
         * The one floor we do apply \u2014 min-height, from computed layout px \u2014 is
         * set inline per element in startTextEdit so it can never come from a
         * transformed rect.
         */
        .rcf-editing {
          user-select: text !important;
          -webkit-user-select: text !important;
          cursor: text !important;
        }
        .rcf-editing:focus,
        .rcf-editing:focus-visible {
          /* The outline colour is set inline per element from the backdrop. */
          outline-style: solid !important;
          outline-width: 2px !important;
          outline-offset: 2px !important;
        }
        /* Inline edit toolbar \u2014 fixed, floats above the edited element */
        .rcf-actions-inline {
          position: fixed;
          display: flex;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          z-index: 10000;
          white-space: nowrap;
          pointer-events: auto;
        }
        .rcf-actions-inline button {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-actions-inline button:hover {
          transform: translateY(-1px);
        }
        .rcf-actions-inline button:active {
          transform: scale(0.98);
        }
        /* Character counter for in-place editing */
        .rcf-char-counter-inline {
          position: fixed;
          font-size: 11px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          padding: 4px 10px;
          border-radius: 6px;
          backdrop-filter: blur(8px);
          z-index: 10000;
          white-space: nowrap;
          pointer-events: none;
        }
        .rcf-actions {
          position: fixed;
          display: flex;
          gap: 6px;
          background: linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1);
          z-index: 10000;
        }
        .rcf-actions button {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 8px 14px;
          font-size: 13px;
          font-weight: 500;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-actions button:hover {
          transform: translateY(-1px);
        }
        .rcf-actions button:active {
          transform: scale(0.98);
        }
        .rcf-btn-save {
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        }
        .rcf-btn-save:hover {
          box-shadow: 0 6px 16px rgba(16, 185, 129, 0.4);
        }
        .rcf-btn-cancel {
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .rcf-btn-cancel:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #e2e8f0;
        }
        .rcf-btn-ai {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%);
          color: #a78bfa;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }
        .rcf-btn-ai:hover {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(59, 130, 246, 0.3) 100%);
          color: #c4b5fd;
        }
        .rcf-updated {
          animation: rcf-highlight 0.6s ease;
        }
        @keyframes rcf-fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes rcf-highlight {
          0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
          50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.3); }
          100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        /*
         * Extra scalar fields (a link's href) for the in-place renderer. Fixed
         * to the viewport and parented to <body>, so the edited element is never
         * wrapped or reparented to host them.
         */
        .rcf-field-panel {
          position: fixed;
          z-index: 10000;
          min-width: 280px;
          padding: 12px;
          border-radius: 10px;
          border: 1px solid transparent;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .rcf-field-panel label {
          display: block;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 6px;
          opacity: 0.75;
        }
        .rcf-field-panel input {
          width: 100%;
          padding: 8px 12px;
          background: rgba(127, 127, 127, 0.12);
          border: 1px solid transparent;
          border-radius: 6px;
          font-size: 13px;
          outline: none;
          font-family: inherit;
        }
        .rcf-field-panel input:focus {
          border-color: rgba(59, 130, 246, 0.6);
        }
        /* Animation indicator \u2014 fixed to the viewport, never a child of the
           edited element (its label used to leak into the saved content). */
        .rcf-animation-indicator {
          position: fixed;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 10001;
          background: rgba(251, 191, 36, 0.22);
          border: 1px solid rgba(251, 191, 36, 0.45);
          color: #b45309;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-family: ui-sans-serif, system-ui, sans-serif;
          white-space: nowrap;
        }
        /* Form popover */
        .rcf-form-popover input:focus {
          border-color: rgba(59, 130, 246, 0.5);
          background: rgba(255, 255, 255, 0.08);
        }
        /* Container hint animation */
        @keyframes rcf-hintFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .rcf-container-hint {
          animation: rcf-hintFadeIn 0.3s ease forwards;
        }
        /* Modal animation */
        @keyframes rcf-modal-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        /* Image editor specific */
        .rcf-modal img {
          transition: opacity 0.2s ease;
        }
        .rcf-modal img.loading {
          opacity: 0.5;
        }
      `,document.head.appendChild(e)}calculateMaxChars(e){const t={minChars:50,maxCharsAbsolute:2e3,maxCharsDefault:500};try{const n=window.getComputedStyle(e),o=parseFloat(n.width)||0,a=parseFloat(n.height)||0,r=parseFloat(n.fontSize)||16,i=parseFloat(n.lineHeight)||r*1.2,s=Math.floor(o/(r*.5)),c=Math.max(1,Math.floor(a/i)),g=Math.floor(s*c*.8);return Math.max(t.minChars,Math.min(g||t.maxCharsDefault,t.maxCharsAbsolute))}catch(n){return t.maxCharsDefault}}checkOverflow(e,t){try{const n=window.getComputedStyle(e),o=e.cloneNode(!1);o.removeAttribute("id"),o.removeAttribute("data-rcf-id"),o.removeAttribute("data-rcf-editing"),o.removeAttribute("data-rcf-edit-session"),o.removeAttribute("contenteditable"),o.className="",o.textContent=t,o.style.cssText=["position: absolute","visibility: hidden","pointer-events: none","left: -99999px","top: 0","width: "+(parseFloat(n.width)||0)+"px","height: auto","max-height: none","min-height: 0","overflow: visible","font: "+n.font,"letter-spacing: "+n.letterSpacing,"word-spacing: "+n.wordSpacing,"white-space: "+n.whiteSpace,"word-break: "+n.wordBreak,"padding: "+n.padding,"text-transform: "+n.textTransform].join("; ");const a=e.parentNode||document.body;a.appendChild(o);const r=o.scrollHeight>(parseFloat(n.height)||0)*1.1;return a.removeChild(o),r}catch(n){return!1}}startTextEdit(e,t){const n=this,o=t||{},a=e.getAttribute("data-rcf-id"),r=this.elements.get(a);if(!r||e.getAttribute("data-rcf-editing"))return;const i=e.getAttribute("style"),s=this.getFullElementText(e),c=ne.hasMarkupChildren(e),g=[];if(typeof o.onStart=="function"){const d=o.onStart(e);typeof d=="function"&&g.push(d)}const f=window.getComputedStyle(e),y=String(f.mixBlendMode||"normal"),x=String(f.filter||"none");y!=="normal"&&e.style.setProperty("mix-blend-mode","normal","important"),x!=="none"&&e.style.setProperty("filter","none","important");const C=window.getComputedStyle(e),b=ne.measureLayoutFloor(e),w=ne.assessReadability(e),M=ne.resolveAffordances(e),v=String(C.boxShadow);e.setAttribute("data-rcf-editing","true"),e.classList.add("rcf-editing"),e.classList.remove("rcf-hovering"),this.hideHoverHint&&this.hideHoverHint();const L="rcf-edit-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);e.setAttribute("data-rcf-edit-session",L);const E=document.createElement("style");E.id=L+"-styles";const U='[data-rcf-edit-session="'+L+'"]';if(E.textContent=[U+"::selection { background: "+M.selectionBackground+"; color: "+M.selectionColor+"; }",U+"::-moz-selection { background: "+M.selectionBackground+"; color: "+M.selectionColor+"; }"].join(`
`),document.head.appendChild(E),e.style.setProperty("outline","2px solid "+M.outlineColor,"important"),e.style.setProperty("outline-offset","2px","important"),e.style.setProperty("caret-color",M.caretColor,"important"),w.scrim){const d="inset 0 0 0 9999px "+w.scrim;e.style.setProperty("box-shadow",v&&v!=="none"?d+", "+v:d,"important")}!b.inline&&b.minHeight>0&&e.style.setProperty("min-height",b.minHeight+"px"),e.setAttribute("contenteditable","true"),e.setAttribute("spellcheck","true"),e.setAttribute("role","textbox"),e.setAttribute("aria-multiline",b.preservesWhitespace?"true":"false");const S=document.createElement("div");S.className="rcf-actions-inline",S.setAttribute("data-rcf-toolbar",L),S.setAttribute("data-rcf-ignore","");const R=document.createElement("button");R.className="rcf-btn-ai",R.type="button",R.title="AI Suggestions",R.textContent="\u{1FA84} AI";const F=document.createElement("button");F.className="rcf-btn-save",F.type="button",F.title="Save changes (Cmd/Ctrl + Enter)",F.textContent="\u2713 Save";const z=document.createElement("button");z.className="rcf-btn-cancel",z.type="button",z.title="Cancel editing (Esc)",z.textContent="\u2715 Cancel",S.appendChild(R),S.appendChild(F),S.appendChild(z);const N=document.createElement("div");N.className="rcf-char-counter-inline",N.setAttribute("data-rcf-counter",L),N.setAttribute("data-rcf-ignore",""),N.style.color=M.chromeText,N.style.background=M.chromeBackground,N.style.border="1px solid "+M.chromeBorder;const J=o.fields||[],j=[];let _=null;J.length&&(_=document.createElement("div"),_.className="rcf-field-panel",_.setAttribute("data-rcf-ignore",""),_.style.background=M.chromeBackground,_.style.borderColor=M.chromeBorder,J.forEach(function(d){const B=document.createElement("label");B.textContent=d.label,B.style.color=M.chromeText;const O=document.createElement("input");O.type=d.type||"text",O.placeholder=d.placeholder||"",O.value=d.get(e)||"",O.style.color=M.chromeText,O.style.borderColor=M.chromeBorder,_.appendChild(B),_.appendChild(O),j.push({def:d,input:O,initial:O.value})})),document.body.appendChild(S),document.body.appendChild(N),_&&document.body.appendChild(_);let V=0;const K=function(){const d=e.getBoundingClientRect(),B=8,O=S.offsetHeight||44,X=S.offsetWidth||200;let $=d.top-O-B;$<4&&($=d.bottom+B);let Z=d.left+d.width/2-X/2;Z=Math.max(8,Math.min(Z,window.innerWidth-X-8)),S.style.top=$+"px",S.style.left=Z+"px";const oe=N.offsetWidth||80;if(N.style.top=d.bottom+4+"px",N.style.left=Math.max(8,Math.min(d.right-oe,window.innerWidth-oe-8))+"px",_){const ae=_.offsetWidth||280,be=_.offsetHeight||90;let le=d.bottom+28;le+be>window.innerHeight-8&&(le=Math.max(8,d.top-be-28)),_.style.top=le+"px",_.style.left=Math.max(8,Math.min(d.left,window.innerWidth-ae-8))+"px"}},Y=function(){V||(V=requestAnimationFrame(function(){V=0,K()}))};K(),window.addEventListener("scroll",Y,!0),window.addEventListener("resize",Y),window.visualViewport&&(window.visualViewport.addEventListener("resize",Y),window.visualViewport.addEventListener("scroll",Y));let q=null;typeof ResizeObserver=="function"&&(q=new ResizeObserver(Y),q.observe(e)),ne.whenFontsReady(window).then(Y);const Q=function(){const d=e.textContent||"";return b.preservesWhitespace?d:d.trim()};let ee=n.calculateMaxChars(e);const p=function(){const d=Q().length;N.textContent=d+" / "+ee,d>ee?(N.style.color="#ef4444",N.style.background="rgba(239, 68, 68, 0.2)",N.style.borderColor="rgba(239, 68, 68, 0.4)"):d>ee*.9?(N.style.color="#f59e0b",N.style.background="rgba(245, 158, 11, 0.2)",N.style.borderColor="rgba(245, 158, 11, 0.4)"):(N.style.color=M.chromeText,N.style.background=M.chromeBackground,N.style.borderColor=M.chromeBorder)};ne.whenFontsReady(window).then(function(){ee=n.calculateMaxChars(e),p()}),e.addEventListener("input",p),e.addEventListener("input",Y),p();try{e.focus({preventScroll:!0})}catch(d){e.focus()}const h=window.getSelection();if(h){const d=document.createRange();d.selectNodeContents(e),h.removeAllRanges(),h.addRange(d)}let u=!1,l=null;const m=function(){if(u)return;u=!0,l&&(window.removeEventListener("beforeunload",l),l=null),window.removeEventListener("scroll",Y,!0),window.removeEventListener("resize",Y),window.visualViewport&&(window.visualViewport.removeEventListener("resize",Y),window.visualViewport.removeEventListener("scroll",Y)),q&&q.disconnect(),V&&cancelAnimationFrame(V),document.removeEventListener("mousedown",W),e.removeAttribute("contenteditable"),e.removeAttribute("spellcheck"),e.removeAttribute("role"),e.removeAttribute("aria-multiline"),e.removeAttribute("data-rcf-editing"),e.removeAttribute("data-rcf-edit-session"),e.classList.remove("rcf-editing"),i===null?e.removeAttribute("style"):e.setAttribute("style",i),[S,N,_].forEach(function(B){B&&B.parentNode&&B.parentNode.removeChild(B)});const d=document.getElementById(L+"-styles");d&&d.remove(),g.forEach(function(B){try{B()}catch(O){console.warn("ReCopyFast: edit teardown failed",O)}})},I=function(){return j.some(function(d){return d.input.value!==d.initial})};l=function(d){if(!u&&!(Q()===s&&!I()))return d.preventDefault(),d.returnValue="",""},window.addEventListener("beforeunload",l);const k=async function(){const d=Q(),B=d!==s;if(!B&&!I()){m();return}if(B&&d.length>2e3&&!confirm("Content exceeds 2000 characters. This may cause issues. Save anyway?")||B&&c&&!confirm("This element contains formatting (bold, links, emphasis) that will be replaced by plain text. Continue?")||B&&n.checkOverflow(e,d)&&!confirm("This content may overflow the container and affect layout. Save anyway?"))return;const O={};j.forEach(function(X){O[X.def.key]=X.input.value.trim()});try{await n.persistContentUpdate(a,d,typeof o.payload=="function"?o.payload(O):void 0)}catch(X){alert(X.message||"Failed to save content. Please try again.");return}B&&(e.textContent=d,r.originalContent=d),j.forEach(function(X){X.input.value!==X.initial&&X.def.set(e,X.input.value.trim())}),m(),e.classList.add("rcf-updated"),setTimeout(function(){e.classList.remove("rcf-updated")},500)},P=function(){Q()!==s&&(e.textContent=s),m()};F.onclick=function(d){d.preventDefault(),d.stopPropagation(),k()},z.onclick=function(d){d.preventDefault(),d.stopPropagation(),P()},R.onclick=function(d){d.preventDefault(),d.stopPropagation(),n.showAISuggestions({get value(){return Q()},set value(B){e.textContent=B,p(),Y()}},a)};const A=parseFloat(C.lineHeight)||parseFloat(C.fontSize)*1.2||20,G=s.indexOf(`
`)!==-1||b.preservesWhitespace||b.minHeight>A*2;e.addEventListener("keydown",function(d){d.key==="Escape"?(d.preventDefault(),P()):(d.key==="Enter"&&(d.metaKey||d.ctrlKey)||d.key==="Enter"&&!d.shiftKey&&!G)&&(d.preventDefault(),k())}),e.addEventListener("paste",function(d){d.preventDefault();const B=(d.clipboardData||window.clipboardData).getData("text/plain");document.execCommand("insertText",!1,B),p()}),j.forEach(function(d){d.input.addEventListener("keydown",function(B){B.key==="Escape"?(B.preventDefault(),P()):B.key==="Enter"&&(B.preventDefault(),k())})});const W=function(d){e.contains(d.target)||S.contains(d.target)||N.contains(d.target)||_&&_.contains(d.target)||k()};setTimeout(function(){document.addEventListener("mousedown",W)},100)}startInlineEdit(e){this.startTextEdit(e)}openImageEditor(e){const t=this,n=e.getAttribute("data-rcf-id"),o=this.elements.get(n);if(!o||e.getAttribute("data-rcf-editing"))return;e.setAttribute("data-rcf-editing","true"),e.classList.add("rcf-editing"),e.classList.remove("rcf-hovering");const a=e.tagName.toLowerCase()==="img",r=a?e.src:(e.style.backgroundImage||"").replace(/url\(['"]?([^'"]+)['"]?\)/,"$1"),i=a?e.alt:"",s=window.getComputedStyle(e),c=Math.round(parseFloat(s.width)||0),g=Math.round(parseFloat(s.height)||0);let f=null;const y=this.createOverlay(),x=document.createElement("div");x.className="rcf-modal";const C=document.createElement("div");C.style.cssText="text-align: center; margin-bottom: 24px;";const b=document.createElement("div");b.className="rcf-modal-icon",b.style.background="linear-gradient(135deg, rgba(59, 130, 246, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%)",b.style.border="1px solid rgba(59, 130, 246, 0.3)",b.textContent="\u{1F5BC}\uFE0F";const w=document.createElement("h2");w.className="rcf-modal-title",w.textContent="Edit Image";const M=document.createElement("p");M.className="rcf-modal-subtitle",M.textContent="Replace image or edit properties",C.appendChild(b),C.appendChild(w),C.appendChild(M),x.appendChild(C);const v=document.createElement("div");v.style.cssText="margin-bottom: 20px; padding: 16px; background: rgba(15, 23, 42, 0.5); border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.1);";const L=document.createElement("p");L.style.cssText="margin: 0 0 8px 0; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;",L.textContent="Current Image";const E=document.createElement("img");E.src=r,E.style.cssText="max-width: 100%; max-height: 200px; border-radius: 8px; display: block; margin: 0 auto;";const U=document.createElement("p");U.style.cssText="margin: 8px 0 0 0; font-size: 11px; color: #64748b; text-align: center;",U.textContent=c+" \xD7 "+g+" px",v.appendChild(L),v.appendChild(E),v.appendChild(U),x.appendChild(v);const S=document.createElement("div");S.style.cssText="margin-bottom: 16px;";const R=document.createElement("label");R.className="rcf-modal-label",R.textContent="Image URL";const F=document.createElement("input");F.type="url",F.className="rcf-modal-input",F.value=r,F.placeholder="https://example.com/image.jpg",S.appendChild(R),S.appendChild(F),x.appendChild(S);let z=null;if(a){const u=document.createElement("div");u.style.cssText="margin-bottom: 16px;";const l=document.createElement("label");l.className="rcf-modal-label",l.textContent="Alt Text (accessibility)",z=document.createElement("input"),z.type="text",z.className="rcf-modal-input",z.value=i,z.placeholder="Describe this image",u.appendChild(l),u.appendChild(z),x.appendChild(u)}F.addEventListener("input",function(){const u=F.value.trim();u&&(E.src=u)});const N=document.createElement("div");N.style.cssText="margin-bottom: 24px; text-align: center;";const J=document.createElement("label");J.style.cssText="display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; background: rgba(59, 130, 246, 0.1); border: 1px dashed rgba(59, 130, 246, 0.5); border-radius: 10px; cursor: pointer; color: #93c5fd; font-size: 14px; transition: all 0.2s;";const j=document.createElement("span");j.textContent="\u{1F4E4}";const _=document.createElement("span");_.textContent="Upload New Image",J.appendChild(j),J.appendChild(_);const V=document.createElement("input");V.type="file",V.accept=me.join(","),V.style.display="none";const K=document.createElement("div");K.style.cssText="margin-top: 10px; font-size: 12px; color: #94a3b8; min-height: 16px;";const Y=document.createElement("div");Y.style.cssText="margin-top: 8px; height: 4px; border-radius: 2px; background: rgba(255,255,255,0.1); overflow: hidden; display: none;";const q=document.createElement("div");q.style.cssText="height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); transition: width 0.15s ease;",Y.appendChild(q),V.addEventListener("change",async function(u){const l=u.target.files&&u.target.files[0];if(!l)return;const m=ve(l);if(m){K.style.color="#f87171",K.textContent=m,V.value="";return}const I=F.value,k=E.src;J.style.pointerEvents="none",J.style.opacity="0.6",_.textContent="Uploading\u2026",K.style.color="#94a3b8",K.textContent=l.name+" ("+Math.round(l.size/1024)+" KB)",Y.style.display="block",q.style.width="0%";const P=URL.createObjectURL(l);E.src=P;try{const A=await t.uploadImage(l,function(G){q.style.width=G+"%"});F.value=A.url,E.src=A.url,f={width:A.width,height:A.height},K.style.color="#34d399",K.textContent="Uploaded"+(A.width&&A.height?" \u2014 "+A.width+" \xD7 "+A.height+" px":"")}catch(A){F.value=I,E.src=k,K.style.color="#f87171",K.textContent=A.message||"Upload failed. Your previous image is unchanged."}finally{URL.revokeObjectURL(P),J.style.pointerEvents="",J.style.opacity="",_.textContent="Upload New Image",Y.style.display="none",V.value=""}}),J.appendChild(V),N.appendChild(J),N.appendChild(Y),N.appendChild(K),x.appendChild(N);const Q=document.createElement("div");Q.style.cssText="display: flex; gap: 8px; justify-content: flex-end;";const ee=document.createElement("button");ee.className="rcf-modal-btn rcf-modal-btn-ghost",ee.textContent="Cancel";const p=document.createElement("button");p.className="rcf-modal-btn rcf-modal-btn-success",p.textContent="Save Changes",Q.appendChild(ee),Q.appendChild(p),x.appendChild(Q),y.appendChild(x),document.body.appendChild(y);const h=function(){e.removeAttribute("data-rcf-editing"),e.classList.remove("rcf-editing"),document.body.contains(y)&&document.body.removeChild(y)};ee.onclick=h,y.onclick=function(u){u.target===y&&h()},p.onclick=async function(){const u=F.value.trim();if(!u){alert("Please enter an image URL");return}if(/^data:/i.test(u)){alert('Inline image data cannot be saved. Use "Upload New Image" so the file is hosted, or paste an image URL.');return}p.disabled=!0,p.textContent="Saving\u2026";try{await t.persistContentUpdate(n,u,{contentType:"image",alt:a?z.value:null,width:f?f.width:void 0,height:f?f.height:void 0})}catch(l){alert(l.message||"Failed to save image. Please try again."),p.disabled=!1,p.textContent="Save Changes";return}a?(he(e,u),z&&(e.alt=z.value)):e.style.backgroundImage='url("'+u+'")',o.originalContent=u,e.classList.add("rcf-updated"),setTimeout(function(){e.classList.remove("rcf-updated")},500),h()},document.addEventListener("keydown",function u(l){l.key==="Escape"&&(h(),document.removeEventListener("keydown",u))})}startLinkEdit(e){this.startTextEdit(e,{fields:[{key:"href",label:"Link URL",type:"url",placeholder:"https://example.com",get:function(t){return t.getAttribute("href")||""},set:function(t,n){n&&t.setAttribute("href",n)}}],payload:function(t){return{href:t.href}}})}startAnimatedEdit(e){this.startTextEdit(e,{onStart:function(t){t.style.setProperty("animation-play-state","paused","important"),t.style.setProperty("transition","none","important");const n=document.createElement("div");n.className="rcf-animation-indicator",n.setAttribute("data-rcf-ignore",""),n.textContent="\u23F8 Animation paused";const o=t.getBoundingClientRect();return n.style.top=Math.max(4,o.top-30)+"px",n.style.left=o.left+o.width/2+"px",document.body.appendChild(n),function(){n.parentNode&&n.parentNode.removeChild(n)}}})}startFormEdit(e){const t=this,n=e.getAttribute("data-rcf-id"),o=this.elements.get(n);if(!o||e.getAttribute("data-rcf-editing"))return;if(e.tagName.toLowerCase()==="button"){this.startInlineEdit(e);return}const i=this.getEditingColors(e).backdropIsLight;e.setAttribute("data-rcf-editing","true"),e.classList.add("rcf-editing"),e.classList.remove("rcf-hovering");const s=e.placeholder||"",c=e.value||"",g=e.getBoundingClientRect(),f=document.createElement("div");f.className="rcf-form-popover";const y=i?"rgba(15, 23, 42, 0.98)":"rgba(255, 255, 255, 0.98)",x=i?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)";f.style.cssText="position: fixed; left: "+g.left+"px; top: "+(g.bottom+8)+"px; background: "+y+"; border-radius: 12px; padding: 16px; box-shadow: 0 12px 36px rgba(0,0,0,0.4); border: 1px solid "+x+"; backdrop-filter: blur(20px); z-index: 10000; min-width: 280px;";const C=document.createElement("p"),b=i?"#94a3b8":"#475569";C.style.cssText="margin: 0 0 12px 0; font-size: 12px; color: "+b+"; text-transform: uppercase; letter-spacing: 0.05em;",C.textContent="Edit Form Field";const w=document.createElement("label"),M=i?"#64748b":"#475569";w.style.cssText="display: block; font-size: 11px; color: "+M+"; margin-bottom: 4px;",w.textContent="Placeholder";const v=document.createElement("input");v.type="text",v.value=s;const L=i?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.05)",E=i?"rgba(255,255,255,0.15)":"rgba(0,0,0,0.15)",U=i?"#e2e8f0":"#1e293b";v.style.cssText="width: 100%; padding: 8px 12px; background: "+L+"; border: 1px solid "+E+"; border-radius: 6px; color: "+U+"; font-size: 13px; margin-bottom: 12px; outline: none;";const S=document.createElement("label");S.style.cssText="display: block; font-size: 11px; color: "+M+"; margin-bottom: 4px;",S.textContent="Default Value";const R=document.createElement("input");R.type="text",R.value=c,R.style.cssText="width: 100%; padding: 8px 12px; background: "+L+"; border: 1px solid "+E+"; border-radius: 6px; color: "+U+"; font-size: 13px; margin-bottom: 16px; outline: none;";const F=document.createElement("div");F.style.cssText="display: flex; gap: 8px; justify-content: flex-end;";const z=document.createElement("button");z.className="rcf-btn-cancel",z.textContent="Cancel";const N=i?"rgba(255,255,255,0.08)":"rgba(0,0,0,0.08)",J=i?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.1)",j=i?"#94a3b8":"#475569";z.style.cssText="padding: 8px 14px; background: "+N+"; border: 1px solid "+J+"; border-radius: 6px; color: "+j+"; cursor: pointer; font-size: 12px;";const _=document.createElement("button");_.className="rcf-btn-save",_.textContent="Save",_.style.cssText="padding: 8px 14px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;",F.appendChild(z),F.appendChild(_),f.appendChild(C),f.appendChild(w),f.appendChild(v),f.appendChild(S),f.appendChild(R),f.appendChild(F),document.body.appendChild(f),v.focus();const V=function(){e.removeAttribute("data-rcf-editing"),e.classList.remove("rcf-editing"),document.body.contains(f)&&document.body.removeChild(f)},K=async function(){try{await t.persistContentUpdate(n,v.value,{value:R.value,contentType:"form"})}catch(q){alert(q.message||"Failed to save form content. Please try again.");return}e.placeholder=v.value,e.value=R.value,o.originalContent=v.value,e.classList.add("rcf-updated"),setTimeout(function(){e.classList.remove("rcf-updated")},500),V()};_.onclick=K,z.onclick=V,v.addEventListener("keydown",function(q){q.key==="Escape"?V():q.key==="Enter"&&K()}),R.addEventListener("keydown",function(q){q.key==="Escape"?V():q.key==="Enter"&&K()});const Y=function(q){!f.contains(q.target)&&q.target!==e&&(V(),document.removeEventListener("click",Y))};setTimeout(function(){document.addEventListener("click",Y)},100)}showContainerHint(e){e.classList.remove("rcf-hovering");const n=this.getEditingColors(e).backdropIsLight,o=e.getBoundingClientRect(),a=document.createElement("div");a.className="rcf-container-hint";const r=n?"rgba(251, 146, 60, 0.15)":"rgba(251, 146, 60, 0.25)",i=n?"rgba(251, 146, 60, 0.4)":"rgba(251, 146, 60, 0.5)",s=n?"#c2410c":"#fb923c";a.style.cssText="position: fixed; left: "+(o.left+o.width/2)+"px; top: "+(o.top-48)+"px; transform: translateX(-50%); background: "+r+"; border: 1px solid "+i+"; color: "+s+"; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-family: ui-sans-serif, system-ui, sans-serif; white-space: nowrap; z-index: 10001; animation: rcf-fadeIn 0.2s ease;",a.textContent="\u{1F4E6} Click on specific text elements inside",document.body.appendChild(a),setTimeout(function(){a.style.opacity="0",a.style.transition="opacity 0.3s ease",setTimeout(function(){document.body.contains(a)&&document.body.removeChild(a)},300)},2e3)}showAISuggestions(e,t){const n=this,o=document.createElement("div");o.style.cssText='position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 10001; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;';const a=document.createElement("div");a.style.cssText="background: linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%); border-radius: 20px; padding: 28px; max-width: 500px; width: 90%; max-height: 80%; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1); animation: rcf-modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);";const r=document.createElement("div");r.style.cssText="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;";const i=document.createElement("div");i.style.cssText="display: flex; align-items: center; gap: 10px;";const s=document.createElement("span");s.style.cssText="display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%); border-radius: 10px; font-size: 18px; border: 1px solid rgba(139, 92, 246, 0.3);",s.textContent="\u2728";const c=document.createElement("h3");c.style.cssText="margin: 0; color: #f1f5f9; font-size: 18px; font-weight: 600;",c.textContent="AI Content Suggestions",i.appendChild(s),i.appendChild(c);const g=document.createElement("button");g.style.cssText="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.1); width: 32px; height: 32px; border-radius: 8px; font-size: 18px; cursor: pointer; color: #94a3b8; display: flex; align-items: center; justify-content: center; transition: all 0.2s;",g.textContent="\xD7",g.onmouseenter=function(){g.style.background="rgba(255, 255, 255, 0.12)",g.style.color="#e2e8f0"},g.onmouseleave=function(){g.style.background="rgba(255, 255, 255, 0.08)",g.style.color="#94a3b8"},r.appendChild(i),r.appendChild(g);const f=document.createElement("div");f.style.cssText="margin-bottom: 20px;";const y=document.createElement("label");y.style.cssText="display: block; margin-bottom: 8px; font-weight: 500; color: #cbd5e1; font-size: 13px;",y.textContent="Optimization Goal";const x=document.createElement("select");x.style.cssText=`width: 100%; padding: 12px 16px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 10px; background: rgba(15, 23, 42, 0.6); color: #f1f5f9; font-size: 14px; cursor: pointer; transition: all 0.2s; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2394a3b8' d='M6 8L1 3h10z'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 12px center;`,[{value:"improve",text:"\u2728 Improve clarity and readability"},{value:"shorten",text:"\u{1F4DD} Make more concise"},{value:"expand",text:"\u{1F4D6} Add more detail"},{value:"engage",text:"\u{1F3AF} Optimize for engagement"},{value:"professional",text:"\u{1F4BC} Make more professional"},{value:"casual",text:"\u{1F60A} Make more casual"}].forEach(function(E){const U=document.createElement("option");U.value=E.value,U.textContent=E.text,U.style.background="#1e293b",x.appendChild(U)}),f.appendChild(y),f.appendChild(x);const b=document.createElement("button");b.style.cssText="width: 100%; padding: 14px; background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%); color: white; border: none; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; margin-bottom: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4); transition: all 0.2s;",b.innerHTML="<span>\u{1FA84}</span><span>Generate Suggestions</span>",b.onmouseenter=function(){b.disabled||(b.style.transform="translateY(-1px)",b.style.boxShadow="0 6px 20px rgba(139, 92, 246, 0.5)")},b.onmouseleave=function(){b.style.transform="translateY(0)",b.style.boxShadow="0 4px 14px rgba(139, 92, 246, 0.4)"};const w=document.createElement("div");w.style.cssText="margin-bottom: 20px;";const M=document.createElement("div");M.style.cssText="display: flex; gap: 8px; justify-content: flex-end;";const v=document.createElement("button");v.style.cssText="padding: 10px 20px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.08); border-radius: 8px; cursor: pointer; color: #94a3b8; font-size: 13px; font-weight: 500; transition: all 0.2s;",v.textContent="Close",v.onmouseenter=function(){v.style.background="rgba(255, 255, 255, 0.12)",v.style.color="#e2e8f0"},v.onmouseleave=function(){v.style.background="rgba(255, 255, 255, 0.08)",v.style.color="#94a3b8"},M.appendChild(v),a.appendChild(r),a.appendChild(f),a.appendChild(b),a.appendChild(w),a.appendChild(M),o.appendChild(a),document.body.appendChild(o);const L=function(){document.body.contains(o)&&document.body.removeChild(o)};g.onclick=L,v.onclick=L,o.onclick=function(E){E.target===o&&L()},b.onclick=async function(){const E=e.value,U=x.value;if(!E.trim()){const S=document.createElement("p");S.style.cssText="color: #fbbf24; margin: 0; padding: 16px; background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.2); border-radius: 10px; font-size: 13px;",S.textContent="\u26A0\uFE0F Please enter some text first.",w.textContent="",w.appendChild(S);return}b.innerHTML="<span>\u{1F504}</span><span>Generating...</span>",b.disabled=!0,b.style.opacity="0.7";try{const S=await fetch(H+"/ai/suggest",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+te},body:JSON.stringify({text:E,context:"website content",goal:U,tone:"professional"})}),R=await S.json();if(S.ok&&R.success)w.textContent="",R.suggestions.forEach(function(F,z){const N=document.createElement("div");N.style.cssText="margin-bottom: 12px; padding: 16px; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; transition: all 0.2s ease; animation: rcf-modal-in 0.3s ease; animation-delay: "+z*.05+"s; animation-fill-mode: both;";const J=document.createElement("p");J.style.cssText="margin: 0 0 12px 0; font-size: 14px; line-height: 1.6; color: #e2e8f0;",J.textContent=F;const j=document.createElement("button");j.style.cssText="padding: 8px 16px; background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);",j.textContent="\u2713 Use This",j.onmouseenter=function(){j.style.transform="translateY(-1px)",j.style.boxShadow="0 4px 12px rgba(59, 130, 246, 0.4)"},j.onmouseleave=function(){j.style.transform="translateY(0)",j.style.boxShadow="0 2px 8px rgba(59, 130, 246, 0.3)"},j.onclick=function(){e.value=F,e.tagName==="TEXTAREA"&&(e.style.height="auto",e.style.height=e.scrollHeight+"px"),e.focus(),L()},N.onmouseenter=function(){N.style.background="rgba(30, 41, 59, 0.6)",N.style.borderColor="rgba(59, 130, 246, 0.3)"},N.onmouseleave=function(){N.style.background="rgba(15, 23, 42, 0.5)",N.style.borderColor="rgba(255, 255, 255, 0.1)"},N.appendChild(J),N.appendChild(j),w.appendChild(N)});else{const F=document.createElement("p");F.style.cssText="color: #f87171; margin: 0; padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px;",F.textContent="Failed to generate suggestions. Please try again.",w.textContent="",w.appendChild(F)}}catch(S){console.error("AI suggestion error:",S);const R=document.createElement("p");R.style.cssText="color: #f87171; margin: 0; padding: 16px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px;",R.textContent="Error connecting to AI service. Please check your connection.",w.textContent="",w.appendChild(R)}finally{b.innerHTML="<span>\u{1FA84}</span><span>Generate Suggestions</span>",b.disabled=!1,b.style.opacity="1"}},o.addEventListener("keydown",function(E){E.key==="Escape"&&L()})}startPolling(){const e=this;setInterval(async function(){try{const t=e.stagingMode?H+"/staging/content/"+D+(e.editSessionToken?"?rcf_edit_token="+encodeURIComponent(e.editSessionToken):"?rcf_token="+encodeURIComponent(e.stagingToken)):H+"/content/"+D,n=await fetch(t,{headers:{Authorization:"Bearer "+te}});if(n.ok){const o=await n.json();(e.stagingMode?o.content:o).forEach(function(r){e.handleContentUpdate(r)})}}catch(t){console.error("ReCopyFast: Polling error:",t)}},5e3)}updateContent(e,t){this.handleContentUpdate({elementId:e,content:t})}destroy(){this.socket&&this.socket.disconnect(),this.observer&&this.observer.disconnect(),this.elements.clear();const e=document.querySelector("#rcf-staging-banner");e&&document.body.removeChild(e)}}class we{constructor(e){this.rcf=e,this.isOpen=!1,this.activeTab="elements",this.panel=null,this.styles=[],this.languages=[],this.versions=[],this.themes=[],this.selectedElements=new Set}open(){this.isOpen||(this.isOpen=!0,this.createPanel(),this.loadTabData())}close(){this.isOpen&&(this.isOpen=!1,this.panel&&document.body.contains(this.panel)&&(this.panel.style.transform="translateX(100%)",setTimeout(()=>{this.panel&&document.body.contains(this.panel)&&document.body.removeChild(this.panel),this.panel=null},300)))}createPanel(){const e=this;if(!document.querySelector("#rcf-edit-board-styles")){const s=document.createElement("style");s.id="rcf-edit-board-styles",s.textContent=`
          .rcf-edit-board {
            position: fixed;
            top: 0;
            right: 0;
            width: 420px;
            height: 100vh;
            background: linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(10, 15, 30, 0.98) 100%);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            box-shadow: -20px 0 60px rgba(0, 0, 0, 0.5);
            z-index: 99998;
            display: flex;
            flex-direction: column;
            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #e2e8f0;
            transform: translateX(100%);
            transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          }
          .rcf-edit-board.rcf-open {
            transform: translateX(0);
          }
          .rcf-eb-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            background: rgba(30, 41, 59, 0.5);
          }
          .rcf-eb-title {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 16px;
            font-weight: 600;
            color: #f1f5f9;
          }
          .rcf-eb-close {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            color: #94a3b8;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 18px;
          }
          .rcf-eb-close:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #e2e8f0;
          }
          .rcf-eb-tabs {
            display: flex;
            gap: 2px;
            padding: 8px 16px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
            background: rgba(15, 23, 42, 0.3);
          }
          .rcf-eb-tab {
            padding: 8px 12px;
            font-size: 12px;
            font-weight: 500;
            color: #64748b;
            background: transparent;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
            transition: color 0.15s, background 0.15s;
          }
          .rcf-eb-tab:hover {
            color: #94a3b8;
            background: rgba(255, 255, 255, 0.04);
          }
          .rcf-eb-tab.active {
            background: rgba(255, 255, 255, 0.08);
            color: #f1f5f9;
          }
          .rcf-eb-content {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
          }
          .rcf-eb-section {
            margin-bottom: 24px;
          }
          .rcf-eb-section-title {
            font-size: 13px;
            font-weight: 600;
            color: #94a3b8;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 12px;
          }
          .rcf-eb-card {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.06);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .rcf-eb-card:hover {
            background: rgba(30, 41, 59, 0.6);
          }
          .rcf-eb-card.selected {
            background: rgba(59, 130, 246, 0.1);
            border-color: rgba(59, 130, 246, 0.2);
          }
          .rcf-eb-card-title {
            font-size: 14px;
            font-weight: 500;
            color: #f1f5f9;
            margin-bottom: 4px;
          }
          .rcf-eb-card-desc {
            font-size: 12px;
            color: #64748b;
            line-height: 1.4;
          }
          .rcf-eb-card-meta {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
            font-size: 11px;
            color: #64748b;
          }
          .rcf-eb-badge {
            padding: 2px 8px;
            background: rgba(59, 130, 246, 0.2);
            border-radius: 4px;
            font-size: 10px;
            color: #93c5fd;
          }
          .rcf-eb-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 14px;
            font-size: 13px;
            font-weight: 500;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            transition: opacity 0.15s;
          }
          .rcf-eb-btn:hover {
            opacity: 0.9;
          }
          .rcf-eb-btn-primary {
            background: #3b82f6;
            color: white;
          }
          .rcf-eb-btn-success {
            background: #10b981;
            color: white;
          }
          .rcf-eb-btn-ghost {
            background: rgba(255, 255, 255, 0.06);
            color: #94a3b8;
            border: 1px solid rgba(255, 255, 255, 0.08);
          }
          .rcf-eb-btn-ghost:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
          }
          .rcf-eb-empty {
            text-align: center;
            padding: 40px 20px;
            color: #64748b;
          }
          .rcf-eb-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 20px;
            color: #94a3b8;
          }
          .rcf-eb-checkbox {
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 2px solid rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: all 0.2s;
          }
          .rcf-eb-checkbox:checked {
            background: #3b82f6;
            border-color: #3b82f6;
          }
          .rcf-eb-input {
            width: 100%;
            padding: 10px 12px;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #f1f5f9;
            font-size: 13px;
          }
          .rcf-eb-input:focus {
            outline: none;
            border-color: rgba(255, 255, 255, 0.15);
          }
          .rcf-eb-input::placeholder {
            color: #64748b;
          }
          .rcf-eb-select {
            width: 100%;
            padding: 10px 12px;
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            color: #f1f5f9;
            font-size: 13px;
            cursor: pointer;
          }
          .rcf-eb-select:focus {
            outline: none;
            border-color: rgba(255, 255, 255, 0.15);
          }
        `,document.head.appendChild(s)}this.panel=document.createElement("div"),this.panel.className="rcf-edit-board",this.panel.id="rcf-edit-board-panel";const t=document.createElement("div");t.className="rcf-eb-header";const n=document.createElement("div");n.className="rcf-eb-title",n.innerHTML="<span>\u{1F4CB}</span><span>Edit Board</span>";const o=document.createElement("button");o.className="rcf-eb-close",o.textContent="\xD7",o.onclick=()=>e.close(),t.appendChild(n),t.appendChild(o);const a=document.createElement("div");a.className="rcf-eb-tabs",[{id:"elements",label:"Elements"},{id:"styles",label:"Styles"},{id:"languages",label:"Languages"},{id:"history",label:"History"},{id:"themes",label:"Themes"}].forEach(s=>{const c=document.createElement("button");c.className="rcf-eb-tab"+(s.id===e.activeTab?" active":""),c.textContent=s.label,c.onclick=()=>e.switchTab(s.id),a.appendChild(c)});const i=document.createElement("div");i.className="rcf-eb-content",i.id="rcf-eb-content",this.panel.appendChild(t),this.panel.appendChild(a),this.panel.appendChild(i),document.body.appendChild(this.panel),requestAnimationFrame(()=>{e.panel.classList.add("rcf-open")}),this.renderTab()}switchTab(e){this.activeTab=e,this.panel.querySelectorAll(".rcf-eb-tab").forEach(n=>{n.classList.remove("active"),n.textContent.toLowerCase().includes(e)&&n.classList.add("active")}),this.loadTabData()}async loadTabData(){const e=document.getElementById("rcf-eb-content");e.innerHTML='<div class="rcf-eb-loading">Loading...</div>';try{switch(this.activeTab){case"elements":this.renderElementsTab();break;case"styles":await this.loadStyles(),this.renderStylesTab();break;case"languages":await this.loadLanguages(),this.renderLanguagesTab();break;case"history":await this.loadHistory(),this.renderHistoryTab();break;case"themes":await this.loadThemes(),this.renderThemesTab();break}}catch(t){console.error("Error loading tab data:",t),e.innerHTML='<div class="rcf-eb-empty">Failed to load data</div>'}}renderTab(){this.loadTabData()}renderElementsTab(){const e=this,t=document.getElementById("rcf-eb-content");t.innerHTML="";const n=document.createElement("div");n.className="rcf-eb-section";const o=document.createElement("div");o.className="rcf-eb-section-title",o.textContent="Editable Elements ("+this.rcf.elements.size+")",n.appendChild(o);const a=[];if(this.rcf.elements.forEach((r,i)=>{const s=r.type.toLowerCase();s!=="button"&&s!=="a"&&a.push({data:r,elementId:i})}),o.textContent="Editable Elements ("+a.length+")",a.length===0?n.innerHTML+='<div class="rcf-eb-empty">No editable elements found</div>':a.forEach(({data:r,elementId:i})=>{const s=document.createElement("div");s.className="rcf-eb-card",e.selectedElements.has(i)&&s.classList.add("selected");const c=document.createElement("div");c.style.cssText="display: flex; align-items: flex-start; gap: 10px;";const g=document.createElement("input");g.type="checkbox",g.className="rcf-eb-checkbox",g.checked=e.selectedElements.has(i),g.onclick=b=>{b.stopPropagation(),g.checked?e.selectedElements.add(i):e.selectedElements.delete(i),s.classList.toggle("selected",g.checked)};const f=document.createElement("div");f.style.flex="1";const y=document.createElement("div");y.className="rcf-eb-card-title",y.textContent=r.type.toUpperCase();const x=document.createElement("div");x.className="rcf-eb-card-desc";const C=r.originalContent.substring(0,100);x.textContent=C+(r.originalContent.length>100?"...":""),f.appendChild(y),f.appendChild(x),c.appendChild(g),c.appendChild(f),s.appendChild(c),s.onclick=()=>{r.element.scrollIntoView({behavior:"smooth",block:"center"}),r.element.classList.add("rcf-hovering"),setTimeout(()=>r.element.classList.remove("rcf-hovering"),2e3)},n.appendChild(s)}),t.appendChild(n),this.selectedElements.size>0){const r=document.createElement("div");r.style.cssText="position: sticky; bottom: 0; padding: 16px 0; background: linear-gradient(transparent, rgba(15, 23, 42, 0.98) 20%);";const i=document.createElement("div");i.style.cssText="margin-bottom: 10px; font-size: 12px; color: #94a3b8;",i.textContent=this.selectedElements.size+" element(s) selected";const s=document.createElement("div");s.style.cssText="display: flex; gap: 8px;";const c=document.createElement("button");c.className="rcf-eb-btn rcf-eb-btn-primary",c.textContent="\u{1F3A8} Apply Style",c.onclick=()=>e.switchTab("styles"),s.appendChild(c),r.appendChild(i),r.appendChild(s),t.appendChild(r)}}async loadStyles(){try{const t=await(await fetch(H+"/edit-board/styles?siteId="+D,{headers:{Authorization:"Bearer "+this.rcf.stagingToken}})).json();this.styles=[...t.presets||[],...t.custom||[]]}catch(e){console.error("Error loading styles:",e),this.styles=[]}}renderStylesTab(){const e=this,t=document.getElementById("rcf-eb-content");t.innerHTML="";const n=document.createElement("div");if(n.className="rcf-eb-section-title",n.textContent="Apply a writing style",n.style.marginBottom="16px",t.appendChild(n),this.styles.length===0){t.innerHTML+='<div class="rcf-eb-empty">No styles available</div>';return}const o=document.createElement("div");o.style.cssText="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;",this.styles.forEach(r=>{const i=document.createElement("button");i.className="rcf-eb-card",i.style.cssText="text-align: left; width: 100%; cursor: pointer;";const s=document.createElement("div");s.style.cssText="font-size: 13px; font-weight: 600; color: #f1f5f9; margin-bottom: 4px;",s.textContent=r.name;const c=document.createElement("div");c.style.cssText="font-size: 11px; color: #64748b; line-height: 1.3;",c.textContent=r.description||"",i.appendChild(s),i.appendChild(c),i.onclick=async()=>{await e.applyStyle(r.id)},o.appendChild(i)}),t.appendChild(o);const a=document.createElement("div");a.style.cssText="margin-top: 16px; padding: 12px; background: rgba(59, 130, 246, 0.1); border-radius: 6px; font-size: 12px; color: #94a3b8;",a.textContent="Click a style to transform all text on the page with AI.",t.appendChild(a)}async applyStyle(e){const t=this,n=this.selectedElements.size>0?Array.from(this.selectedElements):null,o=document.getElementById("rcf-eb-content");o.innerHTML='<div class="rcf-eb-loading">Applying style...</div>';try{const r=await(await fetch(H+"/edit-board/styles/apply",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+this.rcf.stagingToken},body:JSON.stringify({siteId:D,styleId:e,elementIds:n})})).json();r.success?(o.innerHTML='<div class="rcf-eb-empty">Applied '+r.styleName+" to "+r.transformedCount+" elements</div>",setTimeout(()=>{window.location.reload()},1500)):o.innerHTML='<div class="rcf-eb-empty">'+(r.error||"Failed to apply style")+"</div>"}catch(a){console.error("Error applying style:",a),o.innerHTML='<div class="rcf-eb-empty">Error applying style</div>'}}async loadLanguages(){try{const t=await(await fetch(H+"/edit-board/languages?siteId="+D,{headers:{Authorization:"Bearer "+this.rcf.stagingToken}})).json();this.languages=t.languages||[],this.availableLanguages=t.availableLanguages||[]}catch(e){console.error("Error loading languages:",e),this.languages=[]}}renderLanguagesTab(){const e=this,t=document.getElementById("rcf-eb-content");t.innerHTML="";const n=document.createElement("div");n.className="rcf-eb-section";const o=document.createElement("div");if(o.className="rcf-eb-section-title",o.textContent="Site Languages",n.appendChild(o),this.languages.length===0){const f=document.createElement("div");f.className="rcf-eb-empty",f.textContent="No languages configured",n.appendChild(f)}else this.languages.forEach(f=>{const y=document.createElement("div");y.className="rcf-eb-card";const x=document.createElement("div");x.className="rcf-eb-card-title",x.textContent=f.language_name+" ("+f.language_code+")";const C=document.createElement("div");if(C.className="rcf-eb-card-meta",f.is_default){const w=document.createElement("span");w.className="rcf-eb-badge",w.textContent="Default",C.appendChild(w)}const b=document.createElement("span");b.textContent=Math.round(f.translation_coverage||0)+"% translated",C.appendChild(b),y.appendChild(x),y.appendChild(C),n.appendChild(y)});t.appendChild(n);const a=document.createElement("div");a.className="rcf-eb-section";const r=document.createElement("div");r.className="rcf-eb-section-title",r.textContent="Add Language",a.appendChild(r);const i=document.createElement("select");i.className="rcf-eb-select",i.innerHTML='<option value="">Select language...</option>',(this.availableLanguages||[]).forEach(f=>{if(!this.languages.some(x=>x.language_code===f.code)){const x=document.createElement("option");x.value=f.code,x.textContent=f.name,i.appendChild(x)}});const s=document.createElement("label");s.style.cssText="display: flex; align-items: center; gap: 8px; margin: 10px 0; font-size: 13px; color: #94a3b8;";const c=document.createElement("input");c.type="checkbox",c.className="rcf-eb-checkbox",c.checked=!0,s.appendChild(c),s.appendChild(document.createTextNode("Auto-translate with AI"));const g=document.createElement("button");g.className="rcf-eb-btn rcf-eb-btn-primary",g.style.marginTop="10px",g.textContent="Add Language",g.onclick=async()=>{if(i.value){g.disabled=!0,g.textContent="Adding...";try{await fetch(H+"/edit-board/languages",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+e.rcf.stagingToken},body:JSON.stringify({siteId:D,languageCode:i.value,autoTranslate:c.checked})}),e.loadTabData()}catch(f){console.error("Error adding language:",f),g.disabled=!1,g.textContent="Add Language"}}},a.appendChild(i),a.appendChild(s),a.appendChild(g),t.appendChild(a)}async loadHistory(){try{const t=await(await fetch(H+"/edit-board/history?siteId="+D,{headers:{Authorization:"Bearer "+this.rcf.stagingToken}})).json();this.versions=t.versions||[]}catch(e){console.error("Error loading history:",e),this.versions=[]}}renderHistoryTab(){const e=this,t=document.getElementById("rcf-eb-content");t.innerHTML="";const n=document.createElement("div");n.className="rcf-eb-section";const o=document.createElement("div");o.className="rcf-eb-section-title",o.textContent="Version History",n.appendChild(o),this.versions.length===0?n.innerHTML+='<div class="rcf-eb-empty">No versions saved yet</div>':this.versions.forEach(r=>{const i=document.createElement("div");i.className="rcf-eb-card";const s=document.createElement("div");s.className="rcf-eb-card-title",s.textContent="Version "+r.version_number;const c=document.createElement("div");c.className="rcf-eb-card-desc",c.textContent=r.description||r.change_type||"Manual edit";const g=document.createElement("div");g.className="rcf-eb-card-meta";const y=new Date(r.created_at).toLocaleDateString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});g.innerHTML="<span>"+y+"</span><span>by "+(r.created_by||"Unknown")+"</span>";const x=document.createElement("button");x.className="rcf-eb-btn rcf-eb-btn-ghost",x.style.marginTop="10px",x.textContent="Restore",x.onclick=async C=>{C.stopPropagation(),await e.restoreVersion(r.id)},i.appendChild(s),i.appendChild(c),i.appendChild(g),i.appendChild(x),n.appendChild(i)}),t.appendChild(n);const a=document.createElement("button");a.className="rcf-eb-btn rcf-eb-btn-primary",a.style.width="100%",a.textContent="Save Current Version",a.onclick=async()=>{a.disabled=!0,a.textContent="Saving...";try{await fetch(H+"/edit-board/history",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+e.rcf.stagingToken},body:JSON.stringify({siteId:D,description:"Manual snapshot"})}),e.loadTabData()}catch(r){console.error("Error creating version:",r),a.disabled=!1,a.textContent="Save Current Version"}},t.appendChild(a)}async restoreVersion(e){const t=document.getElementById("rcf-eb-content");t.innerHTML='<div class="rcf-eb-loading">Restoring version...</div>';try{const o=await(await fetch(H+"/edit-board/history/"+e,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+this.rcf.stagingToken}})).json();o.success?(t.innerHTML='<div class="rcf-eb-empty">Restored '+o.elementsRestored+" elements</div>",setTimeout(()=>{window.location.reload()},1500)):t.innerHTML='<div class="rcf-eb-empty">'+(o.error||"Failed to restore")+"</div>"}catch(n){console.error("Error restoring version:",n),t.innerHTML='<div class="rcf-eb-empty">Error restoring version</div>'}}async loadThemes(){try{const t=await(await fetch(H+"/edit-board/themes?siteId="+D,{headers:{Authorization:"Bearer "+this.rcf.stagingToken}})).json();this.themes=t.themes||[]}catch(e){console.error("Error loading themes:",e),this.themes=[]}}renderThemesTab(){const e=this,t=document.getElementById("rcf-eb-content");t.innerHTML="";const n=document.createElement("div");n.className="rcf-eb-section";const o=document.createElement("div");o.className="rcf-eb-section-title",o.textContent="Event Themes",n.appendChild(o),this.themes.length===0?n.innerHTML+='<div class="rcf-eb-empty">No themes created yet</div>':this.themes.forEach(c=>{const g=document.createElement("div");g.className="rcf-eb-card";const f=document.createElement("div");f.className="rcf-eb-card-title",f.textContent=c.name;const y=document.createElement("div");y.className="rcf-eb-card-desc",y.textContent=c.description||c.overrideCount+" content overrides";const x=document.createElement("div");if(x.className="rcf-eb-card-meta",c.is_active){const b=document.createElement("span");b.className="rcf-eb-badge",b.style.background="rgba(16, 185, 129, 0.2)",b.style.color="#6ee7b7",b.textContent="Active",x.appendChild(b)}if(c.schedule_start){const b=document.createElement("span");b.textContent="Scheduled",x.appendChild(b)}const C=document.createElement("button");C.className=c.is_active?"rcf-eb-btn rcf-eb-btn-ghost":"rcf-eb-btn rcf-eb-btn-success",C.style.marginTop="10px",C.textContent=c.is_active?"Deactivate":"Activate",C.onclick=async b=>{b.stopPropagation(),await e.toggleTheme(c.id,!c.is_active)},g.appendChild(f),g.appendChild(y),g.appendChild(x),g.appendChild(C),n.appendChild(g)}),t.appendChild(n);const a=document.createElement("div");a.className="rcf-eb-section";const r=document.createElement("div");r.className="rcf-eb-section-title",r.textContent="Create Theme",a.appendChild(r);const i=document.createElement("input");i.className="rcf-eb-input",i.placeholder="Theme name (e.g., Holiday Sale)";const s=document.createElement("button");s.className="rcf-eb-btn rcf-eb-btn-primary",s.style.cssText="margin-top: 10px; width: 100%;",s.textContent="Create Theme",s.onclick=async()=>{if(i.value.trim()){s.disabled=!0,s.textContent="Creating...";try{await fetch(H+"/edit-board/themes",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+e.rcf.stagingToken},body:JSON.stringify({siteId:D,name:i.value.trim()})}),e.loadTabData()}catch(c){console.error("Error creating theme:",c),s.disabled=!1,s.textContent="Create Theme"}}},a.appendChild(i),a.appendChild(s),t.appendChild(a)}async toggleTheme(e,t){const n=document.getElementById("rcf-eb-content");n.innerHTML='<div class="rcf-eb-loading">'+(t?"Activating...":"Deactivating...")+"</div>";try{await fetch(H+"/edit-board/themes",{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+this.rcf.stagingToken},body:JSON.stringify({siteId:D,themeId:e,isActive:t})}),this.loadTabData()}catch(o){console.error("Error toggling theme:",o),this.loadTabData()}}}window.ReCopyFast=new Ce,window.recopyfast={update:function(T,e){window.ReCopyFast.updateContent(T,e)},destroy:function(){window.ReCopyFast.destroy()},rescan:function(){window.ReCopyFast.scanForContent(),window.ReCopyFast.sendContentMap()},isStaging:function(){return window.ReCopyFast.stagingMode},getStagingAccess:function(){return window.ReCopyFast.stagingAccess},trackConversion:function(T,e){window.ReCopyFast.trackConversion(T,e)}},window.rcf=window.recopyfast})();

