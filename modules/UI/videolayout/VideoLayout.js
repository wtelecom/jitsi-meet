/* global config, APP, $, interfaceConfig, JitsiMeetJS */
/* jshint -W101 */

import AudioLevels from "../audio_levels/AudioLevels";
import Avatar from "../avatar/Avatar";
import BottomToolbar from "../toolbars/BottomToolbar";
import FilmStrip from "./FilmStrip";
import UIEvents from "../../../service/UI/UIEvents";
import UIUtil from "../util/UIUtil";

import RemoteVideo from "./RemoteVideo";
import LargeVideoManager, {VideoContainerType} from "./LargeVideo";
import {PreziContainerType} from '../prezi/Prezi';
import LocalVideo from "./LocalVideo";
import PanelToggler from "../side_pannels/SidePanelToggler";

const RTCUIUtil = JitsiMeetJS.util.RTCUIHelper;

var remoteVideos = {};
var remoteVideoTypes = {};
var localVideoThumbnail = null;

var currentDominantSpeaker = null;
var localLastNCount = config.channelLastN;
var localLastNSet = [];
var lastNEndpointsCache = [];
var lastNPickupId = null;

var eventEmitter = null;

/**
 * Currently focused video jid
 * @type {String}
 */
var focusedVideoResourceJid = null;

/**
 * On contact list item clicked.
 */
function onContactClicked (id) {
    if (APP.conference.isLocalId(id)) {
        $("#localVideoContainer").click();
        return;
    }

    let remoteVideo = remoteVideos[id];
    if (remoteVideo && remoteVideo.hasVideo()) {
        // It is not always the case that a videoThumb exists (if there is
        // no actual video).
        if (remoteVideo.hasVideoStarted()) {
            // We have a video src, great! Let's update the large video
            // now.
            VideoLayout.handleVideoThumbClicked(false, id);
        } else {

            // If we don't have a video src for jid, there's absolutely
            // no point in calling handleVideoThumbClicked; Quite
            // simply, it won't work because it needs an src to attach
            // to the large video.
            //
            // Instead, we trigger the pinned endpoint changed event to
            // let the bridge adjust its lastN set for myjid and store
            // the pinned user in the lastNPickupId variable to be
            // picked up later by the lastN changed event handler.

            lastNPickupId = id;
            eventEmitter.emit(UIEvents.PINNED_ENDPOINT, id);
        }
    }
}

/**
 * Returns the corresponding resource id to the given peer container
 * DOM element.
 *
 * @return the corresponding resource id to the given peer container
 * DOM element
 */
function getPeerContainerResourceId (containerElement) {
    if (localVideoThumbnail.container === containerElement) {
        return localVideoThumbnail.id;
    }

    let i = containerElement.id.indexOf('participant_');

    if (i >= 0) {
        return containerElement.id.substring(i + 12);
    }
}

let largeVideo;

var VideoLayout = {
    init (emitter) {
        eventEmitter = emitter;
        localVideoThumbnail = new LocalVideo(VideoLayout, emitter);

        emitter.addListener(UIEvents.CONTACT_CLICKED, onContactClicked);
        this.lastNCount = config.channelLastN;
    },

    initLargeVideo (isSideBarVisible) {
        largeVideo = new LargeVideoManager();
        largeVideo.updateContainerSize(isSideBarVisible);
        AudioLevels.init();
    },

    setAudioLevel(id, lvl) {
        if (!largeVideo) {
            return;
        }
        AudioLevels.updateAudioLevel(
            id, lvl, largeVideo.id
        );
    },

    isInLastN (resource) {
        return this.lastNCount < 0 || // lastN is disabled
             // lastNEndpoints cache not built yet
            (this.lastNCount > 0 && !lastNEndpointsCache.length) ||
            (lastNEndpointsCache &&
                lastNEndpointsCache.indexOf(resource) !== -1);
    },

    changeLocalAudio (stream) {
        let localAudio = document.getElementById('localAudio');
        localAudio = stream.attach(localAudio);

        // Now when Temasys plugin is converting also <audio> elements to
        // plugin's <object>s, in current layout it will capture click events
        // before it reaches the local video object. We hide it here in order
        // to prevent that.
        //if (RTCBrowserType.isIExplorer()) {
            // The issue is not present on Safari. Also if we hide it in Safari
            // then the local audio track will have 'enabled' flag set to false
            // which will result in audio mute issues
            //  $(localAudio).hide();
            localAudio.width = 1;
            localAudio.height = 1;
        //}
    },

    changeLocalVideo (stream) {
        // Set default display name.
        localVideoThumbnail.setDisplayName();
        localVideoThumbnail.createConnectionIndicator();

        let localId = APP.conference.localId;
        this.onVideoTypeChanged(localId, stream.videoType);

        let {thumbWidth, thumbHeight} = this.resizeThumbnails(false, true);
        AudioLevels.updateAudioLevelCanvas(null, thumbWidth, thumbHeight);

        if (!stream.isMuted()) {
            localVideoThumbnail.changeVideo(stream);
        }

        /* force update if we're currently being displayed */
        if (this.isCurrentlyOnLarge(localId)) {
            this.updateLargeVideo(localId, true);
        }
    },

    /**
     * Get's the localID of the conference and set it to the local video
     * (small one). This needs to be called as early as possible, when muc is
     * actually joined. Otherwise events can come with information like email
     * and setting them assume the id is already set.
     */
    mucJoined () {
        if (largeVideo && !largeVideo.id) {
            this.updateLargeVideo(APP.conference.localId, true);
        }
    },

    /**
     * Adds or removes icons for not available camera and microphone.
     * @param resourceJid the jid of user
     * @param devices available devices
     */
    setDeviceAvailabilityIcons (id, devices) {
        if (APP.conference.isLocalId(id)) {
            localVideoThumbnail.setDeviceAvailabilityIcons(devices);
            return;
        }

        let video = remoteVideos[id];
        if (!video) {
            return;
        }

        video.setDeviceAvailabilityIcons(devices);
    },

    /**
     * Checks if removed video is currently displayed and tries to display
     * another one instead.
     */
    updateRemovedVideo (id) {
        if (!this.isCurrentlyOnLarge(id)) {
            return;
        }

        let newId;

        // We'll show user's avatar if he is the dominant speaker or if
        // his video thumbnail is pinned
        if (remoteVideos[id] && (id === focusedVideoResourceJid
                                || id === currentDominantSpeaker)) {
            newId = id;
        } else {
            // Otherwise select last visible video
            newId = this.electLastVisibleVideo();
        }

        this.updateLargeVideo(newId);
    },

    electLastVisibleVideo () {
        // pick the last visible video in the row
        // if nobody else is left, this picks the local video
        let thumbs = FilmStrip.getThumbs(true).filter('[id!="mixedstream"]');

        let lastVisible = thumbs.filter(':visible:last');
        if (lastVisible.length) {
            let id = getPeerContainerResourceId(lastVisible[0]);
            if (remoteVideos[id]) {
                console.info("electLastVisibleVideo: " + id);
                return id;
            }
            // The RemoteVideo was removed (but the DOM elements may still
            // exist).
        }

        console.info("Last visible video no longer exists");
        thumbs = FilmStrip.getThumbs();
        if (thumbs.length) {
            let id = getPeerContainerResourceId(thumbs[0]);
            if (remoteVideos[id]) {
                console.info("electLastVisibleVideo: " + id);
                return id;
            }
            // The RemoteVideo was removed (but the DOM elements may
            // still exist).
        }

        // Go with local video
        console.info("Fallback to local video...");

        let id = APP.conference.localId;
        console.info("electLastVisibleVideo: " + id);

        return id;
    },

    onRemoteStreamAdded (stream) {
        let id = stream.getParticipantId();
        remoteVideos[id].addRemoteStreamElement(stream);

        // if track is muted make sure we reflect that
        if(stream.isMuted())
        {
            if(stream.getType() === "audio")
                this.onAudioMute(stream.getParticipantId(), true);
            else
                this.onVideoMute(stream.getParticipantId(), true);
        }
    },

    onRemoteStreamRemoved (stream) {
        let id = stream.getParticipantId();
        let remoteVideo = remoteVideos[id];
        if (remoteVideo) { // remote stream may be removed after participant left the conference
            remoteVideo.removeRemoteStreamElement(stream);
        }
    },

    /**
     * Return the type of the remote video.
     * @param id the id for the remote video
     * @returns the video type video or screen.
     */
    getRemoteVideoType (id) {
        return remoteVideoTypes[id];
    },

    handleVideoThumbClicked (noPinnedEndpointChangedEvent,
                                          resourceJid) {
        if(focusedVideoResourceJid) {
            var oldSmallVideo
                    = VideoLayout.getSmallVideo(focusedVideoResourceJid);
            if (oldSmallVideo && !interfaceConfig.filmStripOnly)
                oldSmallVideo.focus(false);
        }

        var smallVideo = VideoLayout.getSmallVideo(resourceJid);
        // Unlock current focused.
        if (focusedVideoResourceJid === resourceJid)
        {
            focusedVideoResourceJid = null;
            // Enable the currently set dominant speaker.
            if (currentDominantSpeaker) {
                if(smallVideo && smallVideo.hasVideo()) {
                    this.updateLargeVideo(currentDominantSpeaker);
                }
            }

            if (!noPinnedEndpointChangedEvent) {
                eventEmitter.emit(UIEvents.PINNED_ENDPOINT);
            }
            return;
        }

        // Lock new video
        focusedVideoResourceJid = resourceJid;

        // Update focused/pinned interface.
        if (resourceJid) {
            if (smallVideo && !interfaceConfig.filmStripOnly)
                smallVideo.focus(true);

            if (!noPinnedEndpointChangedEvent) {
                eventEmitter.emit(UIEvents.PINNED_ENDPOINT, resourceJid);
            }
        }

        this.updateLargeVideo(resourceJid);
    },


    /**
     * Checks if container for participant identified by given id exists
     * in the document and creates it eventually.
     *
     * @return Returns <tt>true</tt> if the peer container exists,
     * <tt>false</tt> - otherwise
     */
    addParticipantContainer (id) {
        let remoteVideo = new RemoteVideo(id, VideoLayout, eventEmitter);
        remoteVideos[id] = remoteVideo;

        let videoType = remoteVideoTypes[id];
        if (videoType) {
            remoteVideo.setVideoType(videoType);
        }

        // In case this is not currently in the last n we don't show it.
        if (localLastNCount && localLastNCount > 0 &&
            FilmStrip.getThumbs().length >= localLastNCount + 2) {
            remoteVideo.showPeerContainer('hide');
        } else {
            VideoLayout.resizeThumbnails(false, true);
        }
    },

    videoactive (videoelem, resourceJid) {

        console.info(resourceJid + " video is now active", videoelem);

        VideoLayout.resizeThumbnails(
            false, false, false, function() {$(videoelem).show();});

        // Update the large video to the last added video only if there's no
        // current dominant, focused speaker or prezi playing or update it to
        // the current dominant speaker.
        if ((!focusedVideoResourceJid &&
            !currentDominantSpeaker &&
             !this.isLargeContainerTypeVisible(PreziContainerType)) ||
            focusedVideoResourceJid === resourceJid ||
            (resourceJid &&
                currentDominantSpeaker === resourceJid)) {
            this.updateLargeVideo(resourceJid, true);
        }
    },

    /**
     * Shows the presence status message for the given video.
     */
    setPresenceStatus (id, statusMsg) {
        remoteVideos[id].setPresenceStatus(statusMsg);
    },

    /**
     * Shows a visual indicator for the moderator of the conference.
     * On local or remote participants.
     */
    showModeratorIndicator () {
        let isModerator = APP.conference.isModerator;
        if (isModerator) {
            localVideoThumbnail.createModeratorIndicatorElement();
        }

        APP.conference.listMembers().forEach(function (member) {
            let id = member.getId();
            if (member.isModerator()) {
                remoteVideos[id].removeRemoteVideoMenu();
                remoteVideos[id].createModeratorIndicatorElement();
            } else if (isModerator) {
                // We are moderator, but user is not - add menu
                if ($(`#remote_popupmenu_${id}`).length <= 0) {
                    remoteVideos[id].addRemoteVideoMenu();
                }
            }
        });
    },

    /*
     * Shows or hides the audio muted indicator over the local thumbnail video.
     * @param {boolean} isMuted
     */
    showLocalAudioIndicator (isMuted) {
        localVideoThumbnail.showAudioIndicator(isMuted);
    },

    /**
     * Resizes thumbnails.
     */
    resizeThumbnails (  animate = false,
                        forceUpdate = false,
                        isSideBarVisible = null,
                        onComplete = null) {
        isSideBarVisible
            = (isSideBarVisible !== null)
                ? isSideBarVisible : PanelToggler.isVisible();

        let {thumbWidth, thumbHeight}
            = FilmStrip.calculateThumbnailSize(isSideBarVisible);

        $('.userAvatar').css('left', (thumbWidth - thumbHeight) / 2);

        FilmStrip.resizeThumbnails(thumbWidth, thumbHeight,
            animate, forceUpdate)
            .then(function () {
                BottomToolbar.resizeToolbar(thumbWidth, thumbHeight);
                AudioLevels.updateCanvasSize(thumbWidth, thumbHeight);
                if (onComplete && typeof onComplete === "function")
                    onComplete();
        });
        return {thumbWidth, thumbHeight};
    },

    /**
     * On audio muted event.
     */
    onAudioMute (id, isMuted) {
        if (APP.conference.isLocalId(id)) {
            localVideoThumbnail.showAudioIndicator(isMuted);
        } else {
            remoteVideos[id].showAudioIndicator(isMuted);
            if (APP.conference.isModerator) {
                remoteVideos[id].updateRemoteVideoMenu(isMuted);
            }
        }
    },

    /**
     * On video muted event.
     */
    onVideoMute (id, value) {
        if (APP.conference.isLocalId(id)) {
            localVideoThumbnail.setMutedView(value);
        } else {
            var remoteVideo = remoteVideos[id];
            remoteVideo.setMutedView(value);
        }

        if (this.isCurrentlyOnLarge(id)) {
            // large video will show avatar instead of muted stream
            this.updateLargeVideo(id, true);
        }
    },

    /**
     * Display name changed.
     */
    onDisplayNameChanged (id, displayName, status) {
        if (id === 'localVideoContainer' ||
            APP.conference.isLocalId(id)) {
            localVideoThumbnail.setDisplayName(displayName);
        } else {
            remoteVideos[id].setDisplayName(displayName, status);
        }
    },

    /**
     * On dominant speaker changed event.
     */
    onDominantSpeakerChanged (id) {
        if (id === currentDominantSpeaker) {
            return;
        }

        let oldSpeakerRemoteVideo = remoteVideos[currentDominantSpeaker];
        // We ignore local user events, but just unmark remote user as dominant
        // while we are talking
        if (APP.conference.isLocalId(id)) {
            if(oldSpeakerRemoteVideo)
            {
                oldSpeakerRemoteVideo.updateDominantSpeakerIndicator(false);
                localVideoThumbnail.updateDominantSpeakerIndicator(true);
                currentDominantSpeaker = null;
            }
            return;
        }

        let remoteVideo = remoteVideos[id];
        if (!remoteVideo) {
            return;
        }

        // Update the current dominant speaker.
        remoteVideo.updateDominantSpeakerIndicator(true);
        localVideoThumbnail.updateDominantSpeakerIndicator(false);

        // let's remove the indications from the remote video if any
        if (oldSpeakerRemoteVideo) {
            oldSpeakerRemoteVideo.updateDominantSpeakerIndicator(false);
        }
        currentDominantSpeaker = id;

        // Local video will not have container found, but that's ok
        // since we don't want to switch to local video.
        // Update the large video if the video source is already available,
        // otherwise wait for the "videoactive.jingle" event.
        if (!focusedVideoResourceJid && remoteVideo.hasVideoStarted()) {
            this.updateLargeVideo(id);
        }
    },

    /**
     * On last N change event.
     *
     * @param lastNEndpoints the list of last N endpoints
     * @param endpointsEnteringLastN the list currently entering last N
     * endpoints
     */
    onLastNEndpointsChanged (lastNEndpoints, endpointsEnteringLastN) {
        if (this.lastNCount !== lastNEndpoints.length)
            this.lastNCount = lastNEndpoints.length;

        lastNEndpointsCache = lastNEndpoints;

        // Say A, B, C, D, E, and F are in a conference and LastN = 3.
        //
        // If LastN drops to, say, 2, because of adaptivity, then E should see
        // thumbnails for A, B and C. A and B are in E's server side LastN set,
        // so E sees them. C is only in E's local LastN set.
        //
        // If F starts talking and LastN = 3, then E should see thumbnails for
        // F, A, B. B gets "ejected" from E's server side LastN set, but it
        // enters E's local LastN ejecting C.

        // Increase the local LastN set size, if necessary.
        if (this.lastNCount > localLastNCount) {
            localLastNCount = this.lastNCount;
        }

        // Update the local LastN set preserving the order in which the
        // endpoints appeared in the LastN/local LastN set.
        var nextLocalLastNSet = lastNEndpoints.slice(0);
        for (var i = 0; i < localLastNSet.length; i++) {
            if (nextLocalLastNSet.length >= localLastNCount) {
                break;
            }

            var resourceJid = localLastNSet[i];
            if (nextLocalLastNSet.indexOf(resourceJid) === -1) {
                nextLocalLastNSet.push(resourceJid);
            }
        }

        localLastNSet = nextLocalLastNSet;
        var updateLargeVideo = false;

        // Handle LastN/local LastN changes.
        FilmStrip.getThumbs().each(( index, element ) => {
            var resourceJid = getPeerContainerResourceId(element);
            var smallVideo = remoteVideos[resourceJid];

            // We do not want to process any logic for our own(local) video
            // because the local participant is never in the lastN set.
            // The code of this function might detect that the local participant
            // has been dropped out of the lastN set and will update the large
            // video
            // Detected from avatar tests, where lastN event override
            // local video pinning
            if(APP.conference.isLocalId(resourceJid))
                return;

            var isReceived = true;
            if (resourceJid &&
                lastNEndpoints.indexOf(resourceJid) < 0 &&
                localLastNSet.indexOf(resourceJid) < 0) {
                console.log("Remove from last N", resourceJid);
                if (smallVideo)
                    smallVideo.showPeerContainer('hide');
                else if (!APP.conference.isLocalId(resourceJid))
                    console.error("No remote video for: " + resourceJid);
                isReceived = false;
            } else if (resourceJid &&
                smallVideo.isVisible() &&
                lastNEndpoints.indexOf(resourceJid) < 0 &&
                localLastNSet.indexOf(resourceJid) >= 0) {
                if (smallVideo)
                    smallVideo.showPeerContainer('avatar');
                else if (!APP.conference.isLocalId(resourceJid))
                    console.error("No remote video for: " + resourceJid);
                isReceived = false;
            }

            if (!isReceived) {
                // resourceJid has dropped out of the server side lastN set, so
                // it is no longer being received. If resourceJid was being
                // displayed in the large video we have to switch to another
                // user.
                if (!updateLargeVideo &&
                    this.isCurrentlyOnLarge(resourceJid)) {
                    updateLargeVideo = true;
                }
            }
        });

        if (!endpointsEnteringLastN || endpointsEnteringLastN.length < 0)
            endpointsEnteringLastN = lastNEndpoints;

        if (endpointsEnteringLastN && endpointsEnteringLastN.length > 0) {
            endpointsEnteringLastN.forEach(function (resourceJid) {

                var remoteVideo = remoteVideos[resourceJid];
                if (remoteVideo)
                    remoteVideo.showPeerContainer('show');

                if (!remoteVideo.isVisible()) {
                    console.log("Add to last N", resourceJid);

                    remoteVideo.addRemoteStreamElement(remoteVideo.videoStream);

                    if (lastNPickupId == resourceJid) {
                        // Clean up the lastN pickup id.
                        lastNPickupId = null;

                        // Don't fire the events again, they've already
                        // been fired in the contact list click handler.
                        VideoLayout.handleVideoThumbClicked(
                            false,
                            resourceJid);

                        updateLargeVideo = false;
                    }
                    remoteVideo.waitForPlayback(
                        remoteVideo.selectVideoElement()[0],
                        remoteVideo.videoStream);
                }
            });
        }

        // The endpoint that was being shown in the large video has dropped out
        // of the lastN set and there was no lastN pickup jid. We need to update
        // the large video now.

        if (updateLargeVideo) {
            var resource;
            // Find out which endpoint to show in the large video.
            for (i = 0; i < lastNEndpoints.length; i++) {
                resource = lastNEndpoints[i];
                if (!resource || APP.conference.isLocalId(resource))
                    continue;

                // videoSrcToSsrc needs to be update for this call to succeed.
                this.updateLargeVideo(resource);
                break;
            }
        }
    },

    /**
     * Updates local stats
     * @param percent
     * @param object
     */
    updateLocalConnectionStats (percent, object) {
        let resolutions = object.resolution;

        object.resolution = resolutions[APP.conference.localId];
        localVideoThumbnail.updateStatsIndicator(percent, object);

        Object.keys(resolutions).forEach(function (id) {
            if (APP.conference.isLocalId(id)) {
                return;
            }

            let resolution = resolutions[id];
            let remoteVideo = remoteVideos[id];

            if (resolution && remoteVideo) {
                remoteVideo.updateResolution(resolution);
            }
        });
    },

    /**
     * Updates remote stats.
     * @param id the id associated with the stats
     * @param percent the connection quality percent
     * @param object the stats data
     */
    updateConnectionStats (id, percent, object) {
        if (remoteVideos[id]) {
            remoteVideos[id].updateStatsIndicator(percent, object);
        }
    },

    /**
     * Hides the connection indicator
     * @param id
     */
    hideConnectionIndicator (id) {
        remoteVideos[id].hideConnectionIndicator();
    },

    /**
     * Hides all the indicators
     */
    hideStats () {
        for(var video in remoteVideos) {
            remoteVideos[video].hideIndicator();
        }
        localVideoThumbnail.hideIndicator();
    },

    removeParticipantContainer (id) {
        // Unlock large video
        if (focusedVideoResourceJid === id) {
            console.info("Focused video owner has left the conference");
            focusedVideoResourceJid = null;
        }

        if (currentDominantSpeaker === id) {
            console.info("Dominant speaker has left the conference");
            currentDominantSpeaker = null;
        }

        var remoteVideo = remoteVideos[id];
        if (remoteVideo) {
            // Remove remote video
            console.info("Removing remote video: " + id);
            delete remoteVideos[id];
            remoteVideo.remove();
        } else {
            console.warn("No remote video for " + id);
        }

        VideoLayout.resizeThumbnails();
    },

    onVideoTypeChanged (id, newVideoType) {
        if (remoteVideoTypes[id] === newVideoType) {
            return;
        }

        console.info("Peer video type changed: ", id, newVideoType);
        remoteVideoTypes[id] = newVideoType;

        var smallVideo;
        if (APP.conference.isLocalId(id)) {
            if (!localVideoThumbnail) {
                console.warn("Local video not ready yet");
                return;
            }
            smallVideo = localVideoThumbnail;
        } else if (remoteVideos[id]) {
            smallVideo = remoteVideos[id];
        } else {
            return;
        }

        smallVideo.setVideoType(newVideoType);
        if (this.isCurrentlyOnLarge(id)) {
            this.updateLargeVideo(id, true);
        }
    },

    showMore (id) {
        if (id === 'local') {
            localVideoThumbnail.connectionIndicator.showMore();
        } else {
            let remoteVideo = remoteVideos[id];
            if (remoteVideo) {
                remoteVideo.connectionIndicator.showMore();
            } else {
                console.info("Error - no remote video for id: " + id);
            }
        }
    },

    addRemoteVideoContainer (id) {
        return RemoteVideo.createContainer(id);
    },

    /**
     * Resizes the video area.
     *
     * @param isSideBarVisible indicates if the side bar is currently visible
     * @param forceUpdate indicates that hidden thumbnails will be shown
     * @param completeFunction a function to be called when the video area is
     * resized.
     */resizeVideoArea (isSideBarVisible,
                        forceUpdate = false,
                        animate = false,
                        completeFunction = null) {

        if (largeVideo) {
            largeVideo.updateContainerSize(isSideBarVisible);
            largeVideo.resize(animate);
        }

        // Calculate available width and height.
        let availableHeight = window.innerHeight;
        let availableWidth = UIUtil.getAvailableVideoWidth(isSideBarVisible);

        if (availableWidth < 0 || availableHeight < 0) {
            return;
        }

        // Resize the thumbnails first.
        this.resizeThumbnails(false, forceUpdate, isSideBarVisible);

        // Resize the video area element.
        $('#videospace').animate({
            right: window.innerWidth - availableWidth,
            width: availableWidth,
            height: availableHeight
        }, {
            queue: false,
            duration: animate ? 500 : 1,
            complete: completeFunction
        });
    },

    getSmallVideo (id) {
        if (APP.conference.isLocalId(id)) {
            return localVideoThumbnail;
        } else {
            return remoteVideos[id];
        }
    },

    changeUserAvatar (id, avatarUrl) {
        var smallVideo = VideoLayout.getSmallVideo(id);
        if (smallVideo) {
            smallVideo.avatarChanged(avatarUrl);
        } else {
            console.warn(
                "Missed avatar update - no small video yet for " + id
            );
        }
        if (this.isCurrentlyOnLarge(id)) {
            largeVideo.updateAvatar(avatarUrl);
        }
    },

    /**
     * Indicates that the video has been interrupted.
     */
    onVideoInterrupted () {
        this.enableVideoProblemFilter(true);
        let reconnectingKey = "connection.RECONNECTING";
        $('#videoConnectionMessage')
            .attr("data-i18n", reconnectingKey)
            .text(APP.translation.translateString(reconnectingKey))
            .css({display: "block"});
    },

    /**
     * Indicates that the video has been restored.
     */
    onVideoRestored () {
        this.enableVideoProblemFilter(false);
        $('#videoConnectionMessage').css({display: "none"});
    },

    enableVideoProblemFilter (enable) {
        if (!largeVideo) {
            return;
        }

        largeVideo.enableVideoProblemFilter(enable);
    },

    isLargeVideoVisible () {
        return this.isLargeContainerTypeVisible(VideoContainerType);
    },

    isCurrentlyOnLarge (id) {
        return largeVideo && largeVideo.id === id;
    },

    updateLargeVideo (id, forceUpdate) {
        if (!largeVideo) {
            return;
        }
        let isOnLarge = this.isCurrentlyOnLarge(id);
        let currentId = largeVideo.id;

        if (!isOnLarge || forceUpdate) {
            if (id !== currentId) {
                eventEmitter.emit(UIEvents.SELECTED_ENDPOINT, id);
            }
            if (currentId) {
                var oldSmallVideo = this.getSmallVideo(currentId);
            }

            let smallVideo = this.getSmallVideo(id);

            let videoType = this.getRemoteVideoType(id);
            largeVideo.updateLargeVideo(
                id,
                smallVideo.videoStream,
                videoType
            ).then(function() {
                // update current small video and the old one
                smallVideo.updateView();
                oldSmallVideo && oldSmallVideo.updateView();
            }, function () {
                // use clicked other video during update, nothing to do.
            });

        } else if (currentId) {
            let currentSmallVideo = this.getSmallVideo(currentId);
            currentSmallVideo.updateView();
        }
    },

    addLargeVideoContainer (type, container) {
        largeVideo && largeVideo.addContainer(type, container);
    },

    removeLargeVideoContainer (type) {
        largeVideo && largeVideo.removeContainer(type);
    },

    /**
     * @returns Promise
     */
    showLargeVideoContainer (type, show) {
        if (!largeVideo) {
            return Promise.reject();
        }

        let isVisible = this.isLargeContainerTypeVisible(type);
        if (isVisible === show) {
            return Promise.resolve();
        }

        // if !show then use default type - large video
        return largeVideo.showContainer(show ? type : VideoContainerType);
    },

    isLargeContainerTypeVisible (type) {
        return largeVideo && largeVideo.state === type;
    },

    /**
     * Returns the id of the current video shown on large.
     * Currently used by tests (troture).
     */
    getLargeVideoID () {
        return largeVideo.id;
    }
};

export default VideoLayout;
