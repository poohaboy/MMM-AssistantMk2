//
// Module : MMM-AssistantMk2
//

"use strict"

const path = require("path")
const record = require("node-record-lpcm16")
const Speaker = require("speaker")
const GoogleAssistant = require("google-assistant")
const speakerHelper = require("./speaker-helper")
const exec = require("child_process").exec;

var NodeHelper = require("node_helper")

module.exports = NodeHelper.create({
	start: function () {
		console.log(this.name + " started");
		this.config = {}
	},

	initializeAfterLoading: function (config) {
		this.config = config
	},

	socketNotificationReceived: function (notification, payload) {
		switch(notification) {
		case "INIT":
			this.initializeAfterLoading(payload)
			this.sendSocketNotification("INITIALIZED")
			break
		case "START":
			this.activate(payload)
			this.sendSocketNotification("STARTED")
			break
		}
	},

	activate: function(payload) {
		var profile = payload.profile
		var profileConfig = payload.config
		var transcriptionHook = this.config.transcriptionHook

		var cfgInstance = {
			auth:{
				keyFilePath : path.resolve(__dirname, this.config.auth.keyFilePath),
				savedTokensPath : path.resolve(__dirname, "profiles/" + profile + ".json"),
			},
			conversation : {
				audio : this.config.audio,
				lang : profileConfig.lang,
				deviceModelId : this.config.deviceModelId,
				deviceId : this.config.deviceInstanceId,
				deviceLocation : this.config.deviceLocation,
				screen : {
					isOn: this.config.useScreen
				}
			},
		}


		var assistant = new GoogleAssistant(cfgInstance.auth)

		var startConversation = (conversation) => {
			let openMicAgain = false
			let foundHook = []
			let foundAction = null
			let foundVideo = null


			// setup the conversation
			conversation
				// send the audio buffer to the speaker
				.on("audio-data", (data) => {
					try {
						speakerHelper.update(data);
					} catch (error) {
						console.log("audio-data-error", error)
						this.sendSocketNotification("AUDIO_ERROR")
					}
    		})
				// done speaking, close the mic
				.on("end-of-utterance", () => {
					console.log("end-of-utterance")
					record.stop()
				})
				// just to spit out to the console what was said (as we say it)
				.on("transcription", (data) => {
					console.log("Transcription:", data.transcription, " --- Done:", data.done)
					this.sendSocketNotification("TRANSCRIPTION", data)
					if (data.done) {
						for (var k in transcriptionHook) {
							if (transcriptionHook.hasOwnProperty(k)) {
								 var v = transcriptionHook[k];
								 var found = data.transcription.match(new RegExp(v, "ig"))
								 if (found !== null) {
									 //this.sendSocketNotification("HOOK", k)
									 foundHook.push(k)
								 }
							}
						}
					}
				})

				// what the assistant said back. But currently, GAS doesn"t return text response with screenOut at same time (maybe.)
				.on("response", text => {
					console.log("Assistant Text Response:", text)
				})
				// if we"ve requested a volume level change, get the percentage of the new level
				// But I"ll not support this feature.
				.on("volume-percent", (percent) => {
					console.log("Volume control... Not yet supported")
				})
				// the device needs to complete an action
				.on("device-action", (action) => {
					console.log("Device Action:", action)
					if (typeof action["inputs"] !== "undefined") {
						//this.sendSocketNotification("NOT_SUPPORTED")
						var intent = action.inputs[0].payload.commands
						console.log("execution", action.inputs[0].payload.commands[0].execution[0])
						foundAction = action.inputs[0].payload.commands
					}
				})
				// once the conversation is ended, see if we need to follow up
				.on("ended", (error, continueConversation) => {
					var payload = {
						"foundHook": foundHook,
						"foundAction": foundAction,
						"foundVideo": foundVideo,
						"error": null,
						"continue": false
					}

					if (error) {
						console.log("Conversation Ended Error:", error)
						payload.error = error
					} else if (continueConversation) {
						openMicAgain = true
						payload.continue = true
					} else {
						console.log("Conversation Completed")
					}

					this.sendSocketNotification("TURN_OVER", payload)
				})

				.on("screen-data", (screen) => {

					var self = this
					var file = require("fs")
					var filePath = path.resolve(__dirname,"temp_screen.html")
					var str = screen.data.toString("utf8")
					str = str.replace("html,body{", "html,body{zoom:" + this.config.screenZoom + ";")
					var re = new RegExp("v\=([0-9a-zA-Z]+)", "ig")
					var youtube = re.exec(str)
					var contents = file.writeFile(filePath, str,
						(error) => {
							if (error) {
							 console.log("Error:- " + error);
							}
							this.sendSocketNotification("SCREEN", str)
						}
					)

					if (youtube) {
						console.log("video found:", youtube[1])
						foundVideo = youtube[1]
					}
				})
				// catch any errors
				.on("error", (error) => {
					console.log("Conversation Error:", error)
					this.sendSocketNotification("CONVERSATION_ERROR", error)
				})

			var mic = record.start(this.config.record)
			mic.on("data", (data) => {
				try {
					conversation.write(data)
				} catch (err) {
					console.log("mic error:", err)
				}
			})

			// setup the speaker
			var speaker = new Speaker({
			 channels: 1,
			 sampleRate: cfgInstance.conversation.audio.sampleRateOut,
			});
			speakerHelper.init(speaker)
			speaker
				.on("open", () => {
					this.sendSocketNotification("SPEAKING_START")
					speakerHelper.open()
				})
				.on("close", () => {
					this.sendSocketNotification("SPEAKING_END")
					//if (hooked) {
					//  exec(this.config.speakerOnScript, (e,so,se)=>{})
					//}
					if (openMicAgain) {
						this.sendSocketNotification("CONTINUOUS_TURN")
						assistant.start(cfgInstance.conversation)
					} else {
						// do nothing
					}
				})
		}

		assistant
			.on("ready", () => {
			// start a conversation!
				console.log("assistant ready")
				this.sendSocketNotification("ASSISTANT_READY")
				assistant.start(cfgInstance.conversation)
			})
			.on("started", startConversation)
			.on("error", (error) => {
				console.log("Assistant Error:", error)
				this.sendSocketNotification("ASSISTANT_ERROR", error)
			})
	},

})