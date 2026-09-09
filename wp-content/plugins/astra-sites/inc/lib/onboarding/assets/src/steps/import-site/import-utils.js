import { __ } from '@wordpress/i18n';
const { themeStatus } = starterTemplates;
import apiFetch from '@wordpress/api-fetch';

/**
 * Parse a fetch Response as JSON, but throw a clear human-readable error when
 * the server returns an HTML page (e.g. a 504 timeout or PHP fatal) instead of
 * JSON. Without this guard, response.json() throws a cryptic SyntaxError.
 *
 * @param {Response} response Fetch API Response object.
 * @return {Promise<*>} Parsed JSON value.
 */
export const safeParseJson = ( response ) => {
	const contentType = response.headers.get( 'content-type' ) || '';
	const nonJsonError = new Error(
		__(
			"Server returned a non-JSON response. This usually means the server timed out or encountered a fatal error. Check your server's max_execution_time and PHP error log, then try again.",
			'astra-sites'
		)
	);
	if ( ! contentType.includes( 'application/json' ) ) {
		throw nonJsonError;
	}
	return response.json().catch( () => {
		throw nonJsonError;
	} );
};

/**
 * Pull a human-readable message out of the various error shapes the
 * plugin install/activate endpoints can return.
 *
 * @param {*}      err      Anything thrown / rejected — string, Error, jQuery xhr, parsed JSON.
 * @param {string} fallback Message to use when nothing usable is found.
 * @return {string} Best-effort error string.
 */
export const extractPluginError = ( err, fallback ) => {
	if ( ! err ) {
		return fallback;
	}
	if ( typeof err === 'string' ) {
		return err;
	}
	const json = err.responseJSON;
	if ( json?.data?.message ) {
		return json.data.message;
	}
	if ( err.data?.message ) {
		return err.data.message;
	}
	if ( err.errorMessage ) {
		return err.errorCode
			? `${ err.errorCode }: ${ err.errorMessage }`
			: err.errorMessage;
	}
	if ( err.message ) {
		return err.message;
	}
	return fallback;
};

export const getDemo = async ( id, storedState ) => {
	const [ , dispatch ] = storedState; // Destructuring assignment only for dispatch method.

	const generateData = new FormData();
	generateData.append( 'action', 'astra-sites-api-request' );
	generateData.append( 'url', 'astra-sites/' + id );
	generateData.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: generateData,
	} )
		.then( safeParseJson )
		.then( ( response ) => {
			if ( response.success ) {
				const isEcommerce = response?.data[ 'required-plugins' ]?.some(
					( plugin ) =>
						plugin?.slug === 'surecart' ||
						plugin?.slug === 'woocommerce'
				);
				starterTemplates.previewUrl =
					'https:' + response.data[ 'astra-site-url' ];
				dispatch( {
					type: 'set',
					templateId: id,
					templateResponse: response.data,
					importErrorMessages: {},
					importErrorResponse: [],
					importError: false,
					isEcommerce,
				} );
			} else {
				let errorMessages = {};

				if ( undefined !== response.data.response_code ) {
					const code = response.data.code.toString();
					switch ( code ) {
						case '401':
						case '404':
							errorMessages = {
								primaryText:
									astraSitesVars?.server_import_primary_error,
								secondaryText: '',
								errorCode: code,
								errorText: response.data.message,
								solutionText: '',
								tryAgain: true,
							};
							break;
						case '500':
							errorMessages = {
								primaryText:
									astraSitesVars?.server_import_primary_error,
								secondaryText: '',
								errorCode: code,
								errorText: response.data.message,
								solutionText:
									astraSitesVars?.ajax_request_failed_secondary,
								tryAgain: true,
							};
							break;

						case 'WP_Error':
							errorMessages = {
								primaryText:
									astraSitesVars?.client_import_primary_error,
								secondaryText: '',
								errorCode: code,
								errorText: response.data.message,
								solutionText: '',
								tryAgain: true,
							};
							break;

						case 'Cloudflare':
							errorMessages = {
								primaryText:
									astraSitesVars?.cloudflare_import_primary_error,
								secondaryText: '',
								errorCode: code,
								errorText: response.data.message,
								solutionText: '',
								tryAgain: true,
							};
							break;

						default:
							errorMessages = {
								primaryText: __(
									'Fetching related demo failed.',
									'astra-sites'
								),
								secondaryText: '',
								errorCode: '',
								errorText: response.data,
								solutionText:
									astraSitesVars?.ajax_request_failed_secondary,
								tryAgain: false,
							};
							break;
					}
					dispatch( {
						type: 'set',
						importError: true,
						importErrorMessages: errorMessages,
						importErrorResponse: response.data,
						templateResponse: null,
					} );
				}
			}
		} )
		.catch( ( error ) => {
			dispatch( {
				type: 'set',
				importError: true,
				importErrorMessages: {
					primaryText: __(
						'Fetching related demo failed.',
						'astra-sites'
					),
					secondaryText:
						astraSitesVars?.ajax_request_failed_secondary,
					errorCode: '',
					errorText: error?.message || error,
					solutionText: '',
					tryAgain: false,
				},
			} );
		} );
};

export const getAiDemo = async (
	{ businessName, selectedTemplate },
	storedState,
	websiteInfo
) => {
	const [ , dispatch ] = storedState;
	const { uuid } = websiteInfo;
	const aiResponse = await apiFetch( {
		path: 'zipwp/v1/ai-site',
		method: 'POST',
		data: {
			template: selectedTemplate,
			business_name: businessName,
			uuid,
		},
	} );

	if ( aiResponse.success ) {
		dispatch( {
			type: 'set',
			templateId: selectedTemplate,
			templateResponse: aiResponse.data?.data,
			importErrorMessages: {},
			importErrorResponse: [],
			importError: false,
		} );
		return { success: true, data: aiResponse.data?.data };
	}
	dispatch( {
		type: 'set',
		importError: true,
		importErrorMessages: {
			primaryText: __( 'Fetching related demo failed.', 'astra-sites' ),
			secondaryText: '',
			errorCode: '',
			errorText:
				typeof aiResponse.data === 'string'
					? aiResponse.data
					: aiResponse?.data?.data ?? '',
			solutionText: '',
			tryAgain: false,
		},
	} );
	return { success: false, data: aiResponse.data };
};

export const checkRequiredPlugins = async ( storedState ) => {
	const [
		{
			enabledFeatureIds,
			selectedEcommercePlugin,
			pluginStatuses: prevPluginStatuses = {},
		},
		dispatch,
	] = storedState;
	const reqPlugins = new FormData();
	reqPlugins.append( 'action', 'astra-sites-required_plugins' );
	reqPlugins.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );
	if ( enabledFeatureIds.length !== 0 ) {
		const featurePlugins = getFeaturePluginList(
			enabledFeatureIds,
			selectedEcommercePlugin
		);
		reqPlugins.append(
			'feature_plugins',
			JSON.stringify( featurePlugins )
		);
	}

	await fetch( ajaxurl, {
		method: 'post',
		body: reqPlugins,
	} )
		.then( safeParseJson )
		.then( ( response ) => {
			const rPlugins = response.data?.required_plugins;
			const notInstalledPlugin = rPlugins.notinstalled || [];
			const notActivePlugins = rPlugins.inactive || [];
			const activePlugins = rPlugins.active || [];

			// Build per-plugin status map for the install screen.
			// Carry forward attempts / error / failedAt from the prior status
			// map so a Refresh (manual or tab-focus) doesn't reset the
			// per-plugin retry counter — otherwise a user could bypass
			// MAX_RETRIES by clicking Refresh between failed attempts.
			// Plugins now reported as 'active' overwrite any prior failed
			// state with a clean success entry.
			const pluginStatuses = {};
			const buildStatus = ( plugins, defaultState ) => {
				plugins.forEach( ( p ) => {
					const prev = prevPluginStatuses[ p.slug ];
					const carry =
						prev && defaultState !== 'success'
							? {
									error: prev.error || null,
									failedAt: prev.failedAt || null,
									attempts: prev.attempts || 0,
							  }
							: { error: null, failedAt: null, attempts: 0 };
					// Don't visually regress a plugin that is already mid-install
					// or mid-activate — a re-check (Refresh or tab-focus) can fire
					// while wp.updates is still processing, and overwriting to
					// 'pending' makes the status pill flicker unnecessarily.
					const state =
						defaultState !== 'success' &&
						( prev?.state === 'installing' ||
							prev?.state === 'activating' )
							? prev.state
							: defaultState;
					pluginStatuses[ p.slug ] = {
						state,
						type: p.optional ? 'optional' : 'required',
						...carry,
						name: p.name,
						slug: p.slug,
						init: p.init,
						// Server-built one-click install URL (update.php?action=install-plugin&plugin=...&_wpnonce=...)
						// for plugins not yet installed; activation URL for inactive ones. Used as the
						// manual-install fallback link after MAX_RETRIES so the user lands directly on
						// the install/activate confirmation page instead of a plugin search.
						installUrl: p.action || null,
					};
				} );
			};
			buildStatus( activePlugins, 'success' );
			buildStatus( notInstalledPlugin, 'pending' );
			buildStatus( notActivePlugins, 'pending' );

			dispatch( {
				type: 'set',
				requiredPlugins: response.data,
				notInstalledList: notInstalledPlugin,
				notActivatedList: notActivePlugins,
				pluginStatuses,
				// Clear the flag so requiredPluginsDone can be set when lists are empty.
				awaitingPluginCheck: false,
			} );
		} )
		.catch( () => {
			// On network failure, clear the flag so the import isn't permanently
			// blocked — awaitingPluginCheck: true would prevent requiredPluginsDone
			// from ever being set, leaving the user with a silent frozen state.
			dispatch( {
				type: 'set',
				awaitingPluginCheck: false,
			} );
		} );
};

export function getFeaturePluginList(
	features,
	selectedEcommercePlugin,
	templateRequiredPluginsSlugList = []
) {
	const requiredPlugins = [];

	features?.forEach( ( feature ) => {
		switch ( feature ) {
			case 'ecommerce':
				if ( selectedEcommercePlugin === 'surecart' ) {
					if (
						! templateRequiredPluginsSlugList.includes( 'surecart' )
					) {
						requiredPlugins.push( {
							name: 'SureCart',
							slug: 'surecart',
							init: 'surecart/surecart.php',
						} );
					}
				} else if ( selectedEcommercePlugin === 'woocommerce' ) {
					if (
						! templateRequiredPluginsSlugList.includes(
							'woocommerce'
						)
					) {
						requiredPlugins.push( {
							name: 'WooCommerce',
							slug: 'woocommerce',
							init: 'woocommerce/woocommerce.php',
						} );
					}

					if (
						! templateRequiredPluginsSlugList.includes(
							'woocommerce-payments'
						)
					) {
						requiredPlugins.push( {
							name: 'WooPayments',
							slug: 'woocommerce-payments',
							init: 'woocommerce-payments/woocommerce-payments.php',
						} );
					}
				}
				break;
			case 'donations':
				if (
					! templateRequiredPluginsSlugList.includes( 'suredonation' )
				) {
					requiredPlugins.push( {
						name: 'SureDonation',
						slug: 'suredonation',
						init: 'suredonation/suredonation.php',
					} );
				}
				break;
			case 'automation-integrations':
				requiredPlugins.push( {
					name: 'OttoKit',
					slug: 'suretriggers',
					init: 'suretriggers/suretriggers.php',
				} );
				break;
			case 'smtp':
				requiredPlugins.push( {
					name: 'Suremail',
					slug: 'suremails',
					init: 'suremails/suremails.php',
				} );
				break;
			case 'seo':
				requiredPlugins.push( {
					name: 'SureRank',
					slug: 'surerank',
					init: 'surerank/surerank.php',
				} );
				break;
			case 'sales-funnels':
				requiredPlugins.push( {
					name: 'CartFlows',
					slug: 'cartflows',
					init: 'cartflows/cartflows.php',
				} );
				requiredPlugins.push( {
					name: 'Woocommerce Cart Abandonment Recovery',
					slug: 'woo-cart-abandonment-recovery',
					init: 'woo-cart-abandonment-recovery/woo-cart-abandonment-recovery.php',
				} );
				break;
			case 'video-player':
				requiredPlugins.push( {
					name: 'Preso Player',
					slug: 'presto-player',
					init: 'presto-player/presto-player.php',
				} );
				break;
			case 'appointment-bookings':
				if (
					! templateRequiredPluginsSlugList.includes( 'latepoint' )
				) {
					requiredPlugins.push( {
						name: 'Latepoint',
						slug: 'latepoint',
						init: 'latepoint/latepoint.php',
					} );
				}

				break;
			case 'live-chat':
				requiredPlugins.push( {
					name: '3CX',
					slug: 'wp-live-chat-support',
					init: 'wp-live-chat-support/wp-live-chat-support.php',
				} );
				break;
			case 'crm-contacts':
				requiredPlugins.push( {
					name: 'SureContact',
					slug: 'surecontact',
					init: 'surecontact/surecontact.php',
				} );
				break;
			case 'surecookie':
				requiredPlugins.push( {
					name: 'SureCookie',
					slug: 'surecookie',
					init: 'surecookie/surecookie.php',
				} );
				break;
			case 'sigmize':
				requiredPlugins.push( {
					name: 'Sigmize',
					slug: 'sigmize',
					init: 'sigmize/sigmize.php',
				} );
				break;
			default:
				break;
		}
	} );

	return requiredPlugins;
}

export const activateAstra = ( storedState ) => {
	const [ , dispatch ] = storedState;

	const data = new FormData();
	data.append( 'action', 'astra-sites-activate_theme' );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	fetch( ajaxurl, {
		method: 'post',
		body: data,
	} )
		.then( safeParseJson )
		.then( ( response ) => {
			if ( response.success ) {
				dispatch( {
					type: 'set',
					themeStatus: response,
					importStatus: __( 'Astra Theme Installed.', 'astra-sites' ),
				} );
			} else {
				dispatch( {
					type: 'set',
					importError: true,
					importErrorMessages: {
						primaryText: __(
							'Astra theme installation failed.',
							'astra-sites'
						),
						secondaryText: '',
						errorCode: '',
						errorText: response.data,
						solutionText: '',
						tryAgain: true,
					},
				} );
			}
		} )
		.catch( ( error ) => {
			/* eslint-disable-next-line no-console -- We are displaying errors in the console. */
			console.error( error );
		} );
};

export const installAstra = ( storedState ) => {
	const [ { importPercent }, dispatch ] = storedState;
	const themeSlug = 'astra';
	let percentage = importPercent;

	if ( 'not-installed' === themeStatus ) {
		if (
			wp.updates.shouldRequestFilesystemCredentials &&
			! wp.updates.ajaxLocked
		) {
			wp.updates.requestFilesystemCredentials();
		}

		percentage += 5;
		dispatch( {
			type: 'set',
			importPercent: percentage,
			importStatus: __( 'Installing Astra Theme…', 'astra-sites' ),
		} );

		wp.updates
			.installTheme( {
				slug: themeSlug,
				ajax_nonce: astraSitesVars?._ajax_nonce,
			} )
			.catch( ( error ) => {
				console.log( error );
				// Check if error is due to folder already existing
				const isFolderExistsError =
					error?.errorCode === 'folder_exists' ||
					( error?.errorMessage &&
						error.errorMessage.toLowerCase().includes( 'folder' ) &&
						error.errorMessage.toLowerCase().includes( 'exist' ) );

				if ( isFolderExistsError ) {
					// Theme is already installed, proceed to activate
					dispatch( {
						importStatus: __(
							'Astra Theme Already Installed.',
							'astra-sites'
						),
					} );
					activateAstra( dispatch );
				} else {
					dispatch( {
						importError: true,
						importErrorMessages: {
							primaryText:
								error?.errorMessage ??
								__(
									'Theme installation failed.',
									'astra-sites'
								),
							tryAgain: true,
						},
					} );
				}
			} );

		// eslint-disable-next-line no-undef
		jQuery( document ).on( 'wp-theme-install-success', function () {
			dispatch( {
				type: 'set',
				importStatus: __( 'Astra Theme Installed.', 'astra-sites' ),
			} );
			activateAstra( storedState );
		} );
	}

	if ( 'installed-but-inactive' === themeStatus ) {
		// WordPress adds "Activate" button after waiting for 1000ms. So we will run our activation after that.
		setTimeout( () => activateAstra( storedState ), 3000 );
	}

	if ( 'installed-and-active' === themeStatus ) {
		dispatch( {
			type: 'set',
			themeStatus: true,
		} );
	}
};

export const setSiteLogo = async ( logo ) => {
	if ( '' === logo.id ) {
		return;
	}
	const data = new FormData();
	data.append( 'action', 'astra-sites-set_site_data' );
	data.append( 'param', 'site-logo' );
	data.append( 'logo', logo.id );
	data.append( 'logo-width', logo.width );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: data,
	} );
};

export const setColorPalettes = async ( palette ) => {
	if ( ! palette ) {
		return;
	}

	const data = new FormData();
	data.append( 'action', 'astra-sites-set_site_data' );
	data.append( 'param', 'site-colors' );
	data.append( 'palette', palette );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: data,
	} );
};

export const setSiteTitle = async ( businessName ) => {
	if ( ! businessName ) {
		return;
	}

	const data = new FormData();
	data.append( 'action', 'astra-sites-set_site_data' );
	data.append( 'param', 'site-title' );
	data.append( 'business-name', businessName );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: data,
	} );
};

export const setSiteLanguage = async ( siteLanguage = 'en_US' ) => {
	if ( ! siteLanguage ) {
		return;
	}

	const data = new FormData();
	data.append( 'action', 'astra-sites-site-language' );
	data.append( 'language', siteLanguage );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: data,
	} );
};

export const saveTypography = async ( selectedValue ) => {
	const data = new FormData();
	data.append( 'action', 'astra-sites-set_site_data' );
	data.append( 'param', 'site-typography' );
	data.append( 'typography', JSON.stringify( selectedValue ) );
	data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	await fetch( ajaxurl, {
		method: 'post',
		body: data,
	} );
};

export const divideIntoChunks = ( chunkSize, inputArray ) => {
	const values = Object.keys( inputArray );
	const final = [];
	let counter = 0;
	let portion = {};

	for ( const key in inputArray ) {
		if ( counter !== 0 && counter % chunkSize === 0 ) {
			final.push( portion );
			portion = {};
		}
		portion[ key ] = inputArray[ values[ counter ] ];
		counter++;
	}
	final.push( portion );

	return final;
};

export const checkFileSystemPermissions = async ( [ , dispatch ] ) => {
	try {
		const formData = new FormData();
		formData.append( 'action', 'astra-sites-filesystem_permission' );
		formData.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );
		const response = await fetch( astraSitesVars?.ajaxurl, {
			method: 'POST',
			body: formData,
		} );
		const data = await safeParseJson( response );

		dispatch( {
			type: 'set',
			fileSystemPermissions: data.data,
		} );
	} catch ( error ) {
		/* eslint-disable-next-line no-console -- We are displaying errors in the console. */
		console.error( error );
	}
};

export const generateAnalyticsLead = async ( tryAgainCount, status, data ) => {
	const importContent = new FormData();
	importContent.append( 'action', 'astra-sites-generate-analytics-lead' );
	importContent.append( 'status', status );
	importContent.append( 'try-again-count', tryAgainCount );
	importContent.append( 'type', 'astra-sites' );
	importContent.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

	// Append extra data.
	Object.entries( data ).forEach( ( [ key, value ] ) =>
		importContent.append( key, value )
	);

	await fetch( ajaxurl, {
		method: 'post',
		body: importContent,
	} );
};
