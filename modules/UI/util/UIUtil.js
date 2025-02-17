/* global $, config, interfaceConfig */

/**
 * Created by hristo on 12/22/14.
 */
 var UIUtil = {

    /**
     * Returns the size of the side panel.
     */
     getSidePanelSize () {
        var availableHeight = window.innerHeight;
        var availableWidth = window.innerWidth;

        var panelWidth = 200;
        if (availableWidth * 0.2 < 200) {
            panelWidth = availableWidth * 0.2;
        }

        return [panelWidth, availableHeight];
     },

    /**
     * Returns the available video width.
     */
    getAvailableVideoWidth: function (isSidePanelVisible) {
        let rightPanelWidth = 0;

        if (isSidePanelVisible) {
            rightPanelWidth = UIUtil.getSidePanelSize()[0];
        }

        return window.innerWidth - rightPanelWidth;
    },

    /**
     * Changes the style class of the element given by id.
     */
    buttonClick: function(id, classname) {
        $(id).toggleClass(classname); // add the class to the clicked element
    },
    /**
     * Returns the text width for the given element.
     *
     * @param el the element
     */
    getTextWidth: function (el) {
        return (el.clientWidth + 1);
    },

    /**
     * Returns the text height for the given element.
     *
     * @param el the element
     */
    getTextHeight: function (el) {
        return (el.clientHeight + 1);
    },

    /**
     * Plays the sound given by id.
     *
     * @param id the identifier of the audio element.
     */
    playSoundNotification: function (id) {
        document.getElementById(id).play();
    },

    /**
     * Escapes the given text.
     */
    escapeHtml: function (unsafeText) {
        return $('<div/>').text(unsafeText).html();
    },

    /**
     * Unescapes the given text.
     *
     * @param {string} safe string which contains escaped html
     * @returns {string} unescaped html string.
     */
    unescapeHtml: function (safe) {
        return $('<div />').html(safe).text();
    },

    imageToGrayScale: function (canvas) {
        var context = canvas.getContext('2d');
        var imgData = context.getImageData(0, 0, canvas.width, canvas.height);
        var pixels  = imgData.data;

        for (var i = 0, n = pixels.length; i < n; i += 4) {
            var grayscale
                = pixels[i] * 0.3 + pixels[i+1] * 0.59 + pixels[i+2] * 0.11;
            pixels[i  ] = grayscale;        // red
            pixels[i+1] = grayscale;        // green
            pixels[i+2] = grayscale;        // blue
            // pixels[i+3]              is alpha
        }
        // redraw the image in black & white
        context.putImageData(imgData, 0, 0);
    },

    setTooltip: function (element, key, position) {
        element.setAttribute("data-i18n", "[data-content]" + key);
        element.setAttribute("data-toggle", "popover");
        element.setAttribute("data-placement", position);
        element.setAttribute("data-html", true);
        element.setAttribute("data-container", "body");
    },

    /**
     * Inserts given child element as the first one into the container.
     * @param container the container to which new child element will be added
     * @param newChild the new element that will be inserted into the container
     */
    prependChild: function (container, newChild) {
        var firstChild = container.childNodes[0];
        if (firstChild) {
            container.insertBefore(newChild, firstChild);
        } else {
            container.appendChild(newChild);
        }
    },

    isButtonEnabled: function (name) {
        var isEnabled = interfaceConfig.TOOLBAR_BUTTONS.indexOf(name) !== -1;
        if (name === 'prezi') {
            return isEnabled && !config.disablePrezi;
        } else if (name === 'recording') {
            return isEnabled && config.enableRecording;
        }
        return isEnabled;
    },

    hideDisabledButtons: function (mappings) {
        var selector = Object.keys(mappings)
          .map(function (buttonName) {
                return UIUtil.isButtonEnabled(buttonName)
                    ? null : mappings[buttonName]; })
          .filter(function (item) { return item; })
          .join(',');
        $(selector).hide();
    },

    redirect (url) {
         window.location.href = url;
     },

     isFullScreen () {
         return document.fullScreen
             || document.mozFullScreen
             || document.webkitIsFullScreen;
     },

     /**
      * Create html attributes string out of object properties.
      * @param {Object} attrs object with properties
      * @returns {String} string of html element attributes
      */
     attrsToString: function (attrs) {
         return Object.keys(attrs).map(
             key => ` ${key}="${attrs[key]}"`
         ).join(' ');
     }
};

export default UIUtil;
