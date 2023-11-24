const { InstanceBase, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const WebSocket = require('ws')
const objectPath = require('object-path')
const upgradeScripts = require('./upgrades.js')
const { combineRgb } = require('@companion-module/base')

class GlensoundMinfernoInstance extends InstanceBase {
	isInitialized = false

	subscriptions = new Map()
	
	pgmStatus = 0
	
	wsRegex = '^wss?:\\/\\/([\\da-z\\.-]+)(:\\d{1,5})?(?:\\/(.*))?$'

	async init(config) {
		this.config = config

		this.initWebSocket()
		this.isInitialized = true

		this.updateVariables()
		this.initActions()
		this.initFeedbacks()
		this.subscribeFeedbacks()
	}

	async destroy() {
		this.isInitialized = false
		if (this.reconnect_timer) {
			clearTimeout(this.reconnect_timer)
			this.reconnect_timer = null
		}
		if (this.ws) {
			this.ws.close(1000)
			delete this.ws
		}
	}

	async configUpdated(config) {
		this.config = config
		this.initWebSocket()
	}

	updateVariables(callerId = null) {
		let variables = new Set()
		variables.add('pgmStatus')
		let defaultValues = {}
		let variableDefinitions = []
		variables.forEach((variable) => {
			variableDefinitions.push({
				name: variable,
				variableId: variable,
			})
		})
		this.setVariableDefinitions(variableDefinitions)
		if (this.config.reset_variables) {
			this.setVariableValues(defaultValues)
		}
	}

	maybeReconnect() {
		if (this.isInitialized && this.config.reconnect) {
			if (this.reconnect_timer) {
				clearTimeout(this.reconnect_timer)
			}
			this.reconnect_timer = setTimeout(() => {
				this.initWebSocket()
			}, 5000)
		}
	}

	initWebSocket() {
		if (this.reconnect_timer) {
			clearTimeout(this.reconnect_timer)
			this.reconnect_timer = null
		}

		const url = this.config.url
		if (!url || url.match(new RegExp(this.wsRegex)) === null) {
			this.updateStatus(InstanceStatus.BadConfig, `WS URL is not defined or invalid`)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)

		if (this.ws) {
			this.ws.close(1000)
			delete this.ws
		}
		this.ws = new WebSocket(url)
		this.ws.binaryType = 'arraybuffer'

		this.ws.on('open', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.log('debug', `Connection opened`)
			if (this.config.reset_variables) {
				this.updateVariables()
			}
		})
		this.ws.on('close', (code) => {
			this.log('debug', `Connection closed with code ${code}`)
			this.updateStatus(InstanceStatus.Disconnected, `Connection closed with code ${code}`)
			this.maybeReconnect()
		})

		this.ws.on('message', this.messageReceivedFromWebSocket.bind(this))

		this.ws.on('error', (data) => {
			this.log('error', `WebSocket error: ${data}`)
		})
	}

	messageReceivedFromWebSocket(data) {
		let d = new Uint8Array(data)
		let status = d[4] == 1 ? true : false
		if (this.pgmStatus != status) {
			this.pgmStatus = status
			this.setVariableValues({['pgmStatus']: d[4]})
			this.checkFeedbacks('pgm_status')
		}
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value:
					"Quick 'event-coded' module to control Glensound Minferno's PGM channel.",
			},
			{
				type: 'textinput',
				id: 'url',
				label: 'Target URL',
				tooltip: 'The URL of the WebSocket server (ws[s]://domain[:port][/path])',
				width: 12,
				regex: '/' + this.wsRegex + '/',
			},
			{
				type: 'checkbox',
				id: 'reconnect',
				label: 'Reconnect',
				tooltip: 'Reconnect on WebSocket error (after 5 secs)',
				width: 6,
				default: true,
			},
			{
				type: 'checkbox',
				id: 'debug_messages',
				label: 'Debug messages',
				tooltip: 'Log incomming and outcomming messages',
				width: 6,
			},
			{
				type: 'checkbox',
				id: 'reset_variables',
				label: 'Reset variables',
				tooltip: 'Reset variables on init and on connect',
				width: 6,
				default: true,
			},
		]
	}

	initFeedbacks() {
		this.setFeedbackDefinitions({
			pgm_status: {
				type: 'boolean',
				name: 'PGM Button status',
				label: 'PGM State',
				description:
					'Status of the PGM channel',
				defaultStyle: {
					bgcolor: combineRgb(255, 0, 0),
					color: combineRgb(0, 0, 0),
				},
				callback: (feedback) => {
					return this.pgmStatus
				},
			},
		})
	}

	initActions() {
		this.setActionDefinitions({
			toggle_mute: {
				name: 'Toggle PGM',
				callback: async (action, context) => {
					let cmd1 = new Uint8Array([0,0,0,1,0,0,0,0,0,0])
					let cmd2 = new Uint8Array([0,0,0,0,0,0,0,0,0,0])
					this.ws.send(cmd1)
					this.ws.send(cmd2)
				},
			},
		})
	}
}

runEntrypoint(GlensoundMinfernoInstance, upgradeScripts)
