import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { isValidAuthMessage, resolveAuthOrigin } from '../utils/auth-message';

/**
 * Hook that owns the ZipWP popup-based authentication flow.
 *
 * Opens the ZipWP auth popup window, listens for the `ZIPWP_AUTH_SUCCESS`
 * postMessage payload, persists the returned token via the
 * `astra-sites-save_auth_token` AJAX action, then fires the supplied
 * `onAuthSuccess` callback. When the popup is blocked, falls back to a
 * full-page redirect to the same auth URL.
 *
 * Multiple instances of this hook can coexist on the page (for example, the
 * signup-login modal and the connect-ZipWP banner) — each instance owns its
 * own popup ref, so `isValidAuthMessage` rejects messages whose source does
 * not match the popup it opened.
 *
 * @since 1.2.77
 *
 * @param {Object}   [options]                         Options bag.
 * @param {Function} [options.onAuthSuccess]           Called after the token
 *                                                     is saved successfully.
 * @param {boolean}  [options.isPremiumTemplate=false] When `true`, the popup
 *                                                     URL is augmented with
 *                                                     premium-design redirect
 *                                                     params so ZipWP can
 *                                                     send the user back to
 *                                                     the design step.
 * @return {{
 *   openPopup: ( ask?: 'register' | 'login' ) => void,
 *   closePopup: () => void,
 *   isAuthLoading: boolean,
 * }} Popup controls and loading state.
 */
export const useZipWPAuthPopup = ( {
	onAuthSuccess,
	isPremiumTemplate = false,
} = {} ) => {
	const { zipwp_auth: zipwpAuth } = wpApiSettings || {};
	const {
		screen_url: screenUrl,
		redirect_url: redirectUrl,
		source,
		utmSource,
		partner_id: partnerId,
	} = zipwpAuth || {};

	const [ isAuthLoading, setIsAuthLoading ] = useState( false );
	const authChildWindow = useRef( null );
	const onAuthSuccessRef = useRef( onAuthSuccess );

	// When the popup is open, poll every 500 ms to detect if the user closed
	// it manually without completing auth. Clears the loading state so the
	// buttons become interactive again instead of staying disabled forever.
	useEffect( () => {
		if ( ! isAuthLoading ) {
			return;
		}
		const id = setInterval( () => {
			if ( authChildWindow.current?.closed ) {
				setIsAuthLoading( false );
				clearInterval( id );
			}
		}, 500 );
		return () => clearInterval( id );
	}, [ isAuthLoading ] );

	// Resolve the expected ZipWP auth origin once. Used to reject cross-origin
	// postMessage events that would otherwise be able to spoof auth success.
	const expectedAuthOrigin = resolveAuthOrigin( screenUrl );

	// Keep callback ref in sync so the message handler always sees the latest.
	useEffect( () => {
		onAuthSuccessRef.current = onAuthSuccess;
	}, [ onAuthSuccess ] );

	const encodedRedirectUrl = encodeURIComponent(
		redirectUrl +
			'&should_resume=1&security=' +
			aiBuilderVars.zipwp_auth_nonce
	);

	const saveAuthToken = useCallback(
		async ( { token, creditToken, email } ) => {
			const formData = new FormData();
			formData.append( 'action', 'astra-sites-save_auth_token' );
			formData.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );
			formData.append( 'token', token );
			formData.append( 'credit_token', creditToken );
			formData.append( 'email', email );

			const response = await fetch( aiBuilderVars.ajax_url, {
				method: 'POST',
				body: formData,
				credentials: 'same-origin',
			} );

			return response.json();
		},
		[]
	);

	// Listen for the ZIPWP_AUTH_SUCCESS postMessage from the popup window.
	useEffect( () => {
		const handleMessage = async ( event ) => {
			// Reject messages from any origin other than the ZipWP auth
			// origin and from any source other than the popup this hook
			// instance opened. Prevents CSRF via forged postMessage from
			// attacker-controlled pages.
			if (
				! isValidAuthMessage(
					event,
					expectedAuthOrigin,
					authChildWindow.current
				)
			) {
				return;
			}

			const { token, credit_token: creditToken, email } = event.data;

			try {
				// Save tokens to the WordPress database.
				const result = await saveAuthToken( {
					token,
					creditToken,
					email,
				} );

				if ( result?.success ) {
					aiBuilderVars.zip_token_exists = true;

					if ( result.data?.zip_plans ) {
						aiBuilderVars.zip_plans = result.data.zip_plans;
					}

					aiBuilderVars.zip_plans_error_code =
						result.data?.error_code ?? '';

					if ( typeof onAuthSuccessRef.current === 'function' ) {
						onAuthSuccessRef.current();
					}
				}
			} catch ( error ) {
				// Network or parse failure — surface in console and reset
				// the loading state so the user can retry instead of being
				// stuck behind a spinner.
				// eslint-disable-next-line no-console
				console.error( 'ZipWP auth token save failed:', error );
			} finally {
				setIsAuthLoading( false );
			}
		};

		window.addEventListener( 'message', handleMessage );
		return () => window.removeEventListener( 'message', handleMessage );
	}, [ saveAuthToken, expectedAuthOrigin ] );

	/**
	 * Open the ZipWP auth popup centered on the current screen.
	 *
	 * @param {'register' | 'login'} [ask='register'] Which auth screen to ask
	 *                                                ZipWP to open.
	 */
	const openPopup = useCallback(
		( ask = 'register' ) => {
			const currentUrl = window.location.href;
			const currentUrlObj = new URL( currentUrl );
			currentUrlObj.hash = '';

			// Add resume + skip-redirect-last-step so ZipWP returns the user
			// straight back to the design step on success.
			currentUrlObj.searchParams.set( 'should_resume', '1' );
			currentUrlObj.searchParams.set( 'skip_redirect_last_step', '1' );
			currentUrlObj.hash = '/design';

			const newUrl = currentUrlObj.toString();

			let url = `${ screenUrl }?type=token&redirect_url=${ encodedRedirectUrl }&ask=/${ ask }&source=${ source }${
				partnerId ? `&aff=${ partnerId }` : ''
			}&utm_source=${ utmSource }&utm_medium=plugin&utm_campaign=build-with-ai&utm_content=start-building`;

			if ( isPremiumTemplate ) {
				url += `&premium_design=true&change_design_redirect=${ encodeURIComponent(
					newUrl
				) }`;
			}

			// Append mode=popup so ZipWP sends postMessage instead of
			// redirecting back to the builder.
			url += '&mode=popup';

			const width = 1280;
			const height = 828;
			const left = window.screenX + ( window.outerWidth - width ) / 2;
			const top = window.screenY + ( window.outerHeight - height ) / 2;
			const features = `width=${ width },height=${ height },left=${ left },top=${ top },scrollbars=yes,resizable=yes`;

			const childWindow = window.open( url, 'zipwp-auth', features );

			if ( childWindow ) {
				authChildWindow.current = childWindow;
				setIsAuthLoading( true );
			} else {
				// Popup blocked — fall back to a full-page redirect.
				window.location.href = url.replace( '&mode=popup', '' );
			}
		},
		[
			screenUrl,
			encodedRedirectUrl,
			source,
			partnerId,
			utmSource,
			isPremiumTemplate,
		]
	);

	/**
	 * Close the popup if it is still open and reset the loading state.
	 */
	const closePopup = useCallback( () => {
		if ( authChildWindow.current && ! authChildWindow.current.closed ) {
			authChildWindow.current.close();
		}
		setIsAuthLoading( false );
	}, [] );

	return { openPopup, closePopup, isAuthLoading };
};

export default useZipWPAuthPopup;
