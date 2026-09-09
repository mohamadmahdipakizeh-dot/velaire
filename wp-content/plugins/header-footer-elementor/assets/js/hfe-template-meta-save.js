/**
 * Save the HFE template metabox settings before "Edit with Elementor" navigates away.
 *
 * Elementor's button never submits the WordPress post form, so the metabox
 * nonce is not sent and `ehf_save_meta()` bails — losing unsaved Template Type
 * and Display Rules. This script intercepts the click, posts the metabox
 * fields to the `hfe_save_template_meta` AJAX endpoint, then resumes the
 * original navigation. If the request fails, navigation proceeds anyway so
 * the editor is never blocked.
 *
 * @since x.x.x
 */
( function( $ ) {
	'use strict';

	var saving = false;
	var allowThrough = false;

	/**
	 * Whether the post is currently in Elementor mode.
	 *
	 * When not in Elementor mode, the switch-mode button starts the
	 * "edit with Elementor" flow; when in Elementor mode it switches
	 * back to the WordPress editor and must not be intercepted.
	 *
	 * @return {boolean} True when the post is in Elementor mode.
	 */
	function isElementorMode() {
		return !! $( '#elementor-switch-mode-input' ).val();
	}

	/**
	 * Post the metabox fields to the AJAX save endpoint.
	 *
	 * @return {Object} A promise resolved when the request completes.
	 */
	function saveTemplateMeta() {
		var $metabox = $( '#ehf-meta-box' );
		var postId = $( '#post_ID' ).val();

		if ( ! $metabox.length || ! postId ) {
			return $.Deferred().resolve().promise();
		}

		var data = $metabox.find( ':input' ).serialize() +
			'&action=hfe_save_template_meta' +
			'&post_id=' + encodeURIComponent( postId );

		// Short timeout: a failed save falls back to pre-fix behavior, so a
		// stalled request must not leave the button unresponsive for long.
		return $.ajax( {
			url: window.ajaxurl,
			type: 'POST',
			data: data,
			timeout: 4000
		} );
	}

	/**
	 * Stop the event, save the metabox, then resume the original action.
	 *
	 * @param {Event}    event   Captured click event.
	 * @param {Function} proceed Callback resuming the original navigation.
	 */
	function intercept( event, proceed ) {
		event.preventDefault();
		event.stopPropagation();

		if ( saving ) {
			return;
		}

		saving = true;

		saveTemplateMeta().always( function() {
			saving = false;
			proceed();
		} );
	}

	// Capture phase: runs before Elementor's own jQuery (bubble phase) handlers.
	document.addEventListener( 'click', function( event ) {
		if ( allowThrough ) {
			allowThrough = false;
			return;
		}

		if ( ! event.target.closest ) {
			return;
		}

		var button = event.target.closest( '#elementor-switch-mode-button' );

		if ( button && ! isElementorMode() ) {
			intercept( event, function() {
				// jQuery re-dispatches the native click synchronously (and only
				// when no handler prevented default), so the flag can be cleared
				// immediately after — it must not leak to unrelated clicks.
				allowThrough = true;
				$( button ).trigger( 'click' );
				allowThrough = false;
			} );
			return;
		}

		var link = event.target.closest( '#elementor-go-to-edit-page-link' );

		if ( link && link.href ) {
			intercept( event, function() {
				window.location.href = link.href;
			} );
		}
	}, true );
} )( jQuery );
