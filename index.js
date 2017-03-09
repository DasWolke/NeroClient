/**
 * Created by julia on 24.01.2017.
 */
let EventEmitter = require('events');
let websocket = require('ws');
let OPCODE = require('./structures/types').MESSAGE_TYPES;
/**
 * @class Worker - The client
 * @param {string} shardToken - The secret token that is shared with nero
 * @param {string} host - The host to connect to, has to be a valid connection url
 */
class Worker extends EventEmitter {
    constructor(shardToken, host) {
        super();
        if (!shardToken) throw new Error('You need to pass in a secret to use!');
        if (!host) throw new Error('You need to pass in a host to connect to!');
        this.host = host;
        this.token = shardToken;
        this.connectionAttempts = 0;
        this.ws = null;
        this.shardId = null;
        this.shardCount = null;
        this.state = {ready: false, connected: false, hearbeat: -1};
        this.hearbeatInterval = null;
        this.hearbeatTimeout = null;
        this.connect();
    }

    /**
     * Connect to the host
     */
    connect() {
        this.ws = new websocket(this.host);
        this.ws.on('open', () => {
            this.connectionAttempts = 1;
            this.onConnection();
        });
        this.ws.on('error', (err) => this.onError(err));
        this.ws.on('close', (code, number) => this.onDisconnect(code, number));
    }

    /**
     * Gets called when the client connected succesfully
     */
    onConnection() {
        this.state.connected = true;
        this.ws.on('message', (msg) => {
            this.onMessage(msg)
        });
    }

    /**
     * Gets called when an error occurs
     * @param err - The error
     */
    onError(err) {
        this.emit('error', err);
        this.reconnect();
    }

    /**
     * Gets called when the websocket disconnected from the host
     * @param code - the disconnect code
     * @param number - /shrug
     */
    onDisconnect(code, number) {
        this.emit('err', `Disconnected with code ${code} and number ${number}`);
        this.state.connected = false;
        this.state.ready = false;
        this.state.hearbeat = -1;
        let time = this.generateInterval(this.connectionAttempts);
        clearInterval(this.hearbeatInterval);
        setTimeout(() => {
            this.connectionAttempts++;
            this.connect();
        }, time);
    }

    /**
     * Gets called when trying to manually reconnect
     */
    reconnect() {
        this.ws.close(1006, 'Trying to reconnect!');
    }

    /**
     * Generates an exponential reconnect interval
     * @param k - number of retries
     * @return {number} - the new interval in milliseconds
     */
    generateInterval(k) {
        let maxInterval = (Math.pow(2, k) - 1) * 1000;

        if (maxInterval > 30 * 1000) {
            maxInterval = 30 * 1000;
        }
        return Math.random() * maxInterval;
    }

    /**
     * When the websocket receives a message
     * @param msg - the message
     * @return {*} - dont mind that.
     */
    onMessage(msg) {
        //Try to parse the msg as json
        try {
            msg = JSON.parse(msg);
        } catch (e) {
            // console.error(msg);
            this.emit('error', e);
            return;
        }
        // console.log(msg);
        //switch over the type of the message
        switch (msg.op) {
            /**
             *
             */
            case OPCODE.identify: {
                // console.log(msg);
                let message = {op: OPCODE.identify, shardToken: this.token};
                if (this.shardCount && this.shardId) {
                    message.d = {sc: this.shardCount, sid: this.shardId};
                }
                this.ws.send(JSON.stringify(message));
                return;
            }
            /**
             * Gets called when the connection has been authenticated successfully, contains shard_id and shard_count
             */
            case OPCODE.ready: {
                // console.log(msg);
                this.state.hearbeat = msg.d.heartbeat;
                this.state.ready = true;
                this.setupHeartbeat(msg.d.heartbeat);
                this.shardId = msg.d.sid;
                this.shardCount = msg.d.sc;
                this.emit('ws_ready', (msg.d));
                if (msg.d.reshard) {
                    this.emit('ws_reshard', (msg.d));
                }
                return;
            }
            /**
             * Gets called when a message is not a system message but an actual message for the software using the client
             */
            case OPCODE.message: {
                this.emit(msg.d.event, msg.d.data);
                return;
            }
            /**
             * The heartbeat
             */
            case OPCODE.hearbeat: {
                clearTimeout(this.hearbeatTimeout);
                // console.log(msg);
                return;
            }
            /**
             * Gets called when the token was not accepted by the server.
             */
            case OPCODE.unauthorized: {
                this.emit('error', `The token was not accepted by the server!`);
                return;
            }
            /**
             * Anything else
             */
            default:
                this.emit('error', `Unkown Message ${JSON.stringify(msg)}`);
                return;
        }
    }

    /**
     * Setups the heartbeat
     * @param beat - heartbeat to send to the server
     */
    setupHeartbeat(beat) {
        this.hearbeatInterval = setInterval(() => {
            try {
                this.ws.send(JSON.stringify({
                    op: OPCODE.hearbeat,
                    shardID: this.shardId,
                    shardToken: this.token
                }));
                this.hearbeatTimeout = setTimeout(() => {
                    this.emit('error', `The master did not respond to the heartbeat!`);
                    this.reconnect();
                }, beat + 5000);
            } catch (e) {
                this.emit('error', e);
                this.reconnect();
            }
        }, beat - 3000);
    }

    /**
     * send a custom msg to the server
     * @param event - id of the event
     * @param msg - the msg
     */
    send(event, msg) {
        this.ws.send(JSON.stringify({
            op: OPCODE.message,
            shardToken: this.token,
            shardID: this.shardId, d: {
                event: event,
                uwu: 'uwu',
                origin: `worker-${process.pid}-${this.shardId}`,
                data: msg,
                sendedAt: Date.now(),
                shardID: this.shardId
            }
        }));
    }

    /**
     * send a custom msg to the server
     * @param event - id of the event
     * @param msg - the msg
     */
    emitRemote(event, msg) {
        this.ws.send(JSON.stringify({
            op: OPCODE.message,
            shardToken: this.token,
            shardID: this.shardId, d: {
                event: event,
                origin: `worker-${process.pid}
                -${this.shardId}`,
                shardID: this.shardId,
                data: msg,
                sendedAt: Date.now()
            }
        }));
    }
}
module.exports = Worker;