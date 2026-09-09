import React, { useEffect } from 'react';
import Lottie from 'react-lottie-player';
import { __, sprintf } from '@wordpress/i18n';
import PreviousStepLink from '../../components/util/previous-step-link/index';
import DefaultStep from '../../components/default-step/index';
import ImportLoader from '../../components/import-steps/import-loader';
import ErrorScreen from '../../components/error/index';
import PluginInstallList, {
	MAX_RETRIES,
} from '../../components/plugin-install-list/index';
import { trackOnboardingStep, getStepIndex } from '../../utils/functions';
import { useStateValue } from '../../store/store';
import lottieJson from '../../../images/website-building.json';
import ICONS from '../../../icons';
import sseImport from './sse-import';
import {
	installAstra,
	saveTypography,
	setSiteLogo,
	setColorPalettes,
	divideIntoChunks,
	checkRequiredPlugins,
	generateAnalyticsLead,
	getDemo,
	extractPluginError,
	safeParseJson,
} from './import-utils';
const { reportError } = starterTemplates;
const successMessageDelay = 8000; // 8 seconds delay for fully assets load.

import './style.scss';

const ImportSite = () => {
	const storedState = useStateValue();
	const [
		{
			importStart,
			importEnd,
			importPercent,
			templateResponse,
			reset,
			themeStatus,
			importError,
			siteLogo,
			activePalette,
			typography,
			customizerImportFlag,
			widgetImportFlag,
			contentImportFlag,
			themeActivateFlag,
			requiredPluginsDone,
			requiredPlugins,
			notInstalledList,
			notActivatedList,
			tryAgainCount,
			xmlImportDone,
			templateId,
			selectedTemplateType,
			builder,
			awaitingPluginCheck,
			skippedPlugins,
			analyticsFlag,
			pluginStatuses,
		},
		dispatch,
	] = storedState;

	let percentage = importPercent;

	/**
	 *
	 * @param {string} primary   Primary text for the error.
	 * @param {string} secondary Secondary text for the error.
	 * @param {string} text      Text received from the AJAX call.
	 * @param {string} code      Error code received from the AJAX call.
	 * @param {string} solution  Solution provided for the current error.
	 * @param {string} stack
	 */
	const report = (
		primary = '',
		secondary = '',
		text = '',
		code = '',
		solution = '',
		stack = ''
	) => {
		dispatch( {
			type: 'set',
			importError: true,
			importErrorMessages: {
				primaryText: primary,
				secondaryText: secondary,
				errorCode: code,
				errorText: text,
				solutionText: solution,
				tryAgain: true,
			},
		} );

		localStorage.removeItem( 'st-import-start' );
		localStorage.removeItem( 'st-import-end' );

		sendErrorReport(
			primary,
			secondary,
			text,
			code,
			solution,
			stack,
			tryAgainCount
		);
	};

	const sendErrorReport = (
		primary = '',
		secondary = '',
		text = '',
		code = '',
		solution = '',
		stack = ''
	) => {
		const error = JSON.stringify( {
			primaryText: primary,
			secondaryText: secondary,
			errorCode: code,
			errorText: text,
			solutionText: solution,
			tryAgain: true,
			stack,
			tryAgainCount,
		} );

		if ( tryAgainCount >= 2 ) {
			generateAnalyticsLead( tryAgainCount, false, {
				id: templateResponse?.id || templateId,
				page_builder: builder,
				template_type: selectedTemplateType,
				error,
			} );
		}
		if ( ! reportError ) {
			return;
		}
		const reportErr = new FormData();
		reportErr.append( 'action', 'astra-sites-report_error' );
		reportErr.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );
		reportErr.append( 'type', 'classic' );
		reportErr.append( 'page_builder', builder );
		reportErr.append( 'template_type', selectedTemplateType );

		reportErr.append( 'error', error );
		reportErr.append( 'id', templateResponse.id );
		reportErr.append( 'plugins', JSON.stringify( requiredPlugins ) );
		fetch( ajaxurl, {
			method: 'post',
			body: reportErr,
		} );
	};

	/**
	 * Verify that all required plugins are installed on the server.
	 * This is a safety check before starting the import process.
	 *
	 * @return {Promise<Object>} Object with verified status and failed plugin details.
	 */
	const verifyPluginsBeforeImport = async () => {
		const allRequiredPlugins =
			templateResponse?.[ 'required-plugins' ] || [];

		// Exclude plugins the user explicitly skipped on the
		// "Required Plugins Missing" screen.
		// Match on `init` (e.g. "sfwd-lms/sfwd_lms.php") because
		// third-party plugin objects from PHP have { init, name, link }
		// but no `slug` property.
		const skippedInits = new Set(
			( skippedPlugins || [] ).map( ( p ) => p.init )
		);
		const requiredPluginsList = allRequiredPlugins.filter(
			( p ) => ! skippedInits.has( p.init )
		);

		if ( requiredPluginsList.length === 0 ) {
			return { verified: true, missing: [], notActivated: [] };
		}

		// No status dispatch here — the user is already on the ImportLoader
		// screen by this point (requiredPluginsDone flipped before importPart1
		// ran), so plugin-step copy like "Verifying plugins: …" doesn't belong
		// here. The "Preparing import…" status set during the transition stays
		// visible until the first content-import phase updates it.

		const formData = new FormData();
		formData.append( 'action', 'astra-sites-verify-required-plugins' );
		formData.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );
		formData.append(
			'required_plugins',
			JSON.stringify( requiredPluginsList )
		);

		try {
			const response = await fetch( ajaxurl, {
				method: 'post',
				body: formData,
			} );
			const result = await safeParseJson( response );

			if ( ! result.success ) {
				// Plugins missing or not activated - handle recovery.
				// Repopulating the notInstalled/notActivated lists triggers
				// the install/activate useEffects to re-run; the all-active
				// effect then re-fires this verification with a fresh timer.
				const { missing, not_activated } = result.data || {};
				const missingPlugins = missing || [];
				const notActivatedPlugins = not_activated || [];

				// Single atomic dispatch — two separate dispatches would cause two
				// renders in React 17 (async context, no auto-batching). Between
				// renders, one list would be empty and the other not, making the
				// requiredPluginsDone useEffect fire with partial state.
				dispatch( {
					type: 'set',
					notInstalledList: missingPlugins,
					notActivatedList: notActivatedPlugins,
				} );

				return {
					verified: false,
					missing: missingPlugins,
					notActivated: notActivatedPlugins,
				};
			}

			return { verified: true, missing: [], notActivated: [] };
		} catch ( error ) {
			// Surface the error to the user — silently returning would leave
			// importPart1() returning early with no state change, and since
			// no useEffect dependency changes, importPart1 would never retry.
			report(
				__( 'Plugin verification failed.', 'astra-sites' ),
				'',
				error.message,
				'',
				'',
				''
			);
			return { verified: false, missing: [], notActivated: [], error };
		}
	};

	/**
	 * Start Import Part 1.
	 */
	const importPart1 = async () => {
		// Plugin verification has already passed on the plugin step (see the
		// all-plugins-active effect's setTimeout); requiredPluginsDone only
		// flips after a successful verifyPluginsBeforeImport(). No need to
		// re-check here.
		let resetStatus = false;
		let cfStatus = false;
		let wooCARStatus = false;
		let latepointStatus = false;
		let formsStatus = false;
		let customizerStatus = false;
		let spectraStatus = false;

		// To make sure template data is available before import.
		await getDemo( templateId || templateResponse?.id, storedState );

		resetStatus = await resetOldSite();

		if ( resetStatus ) {
			// Use retry logic for CartFlows import (max 2 retries)
			cfStatus = await importWithRetry( {
				importFn: importCartflowsFlows,
				importName: __( 'CartFlows Import', 'astra-sites' ),
			} );
		}

		if ( cfStatus ) {
			// Use retry logic for Cart Abandonment Recovery import (max 2 retries)
			wooCARStatus = await importWithRetry( {
				importFn: importCartAbandonmentRecovery,
				importName: __(
					'Cart Abandonment Recovery Import',
					'astra-sites'
				),
			} );
		}

		if ( wooCARStatus ) {
			// Use retry logic for LatePoint import (max 2 retries)
			latepointStatus = await importWithRetry( {
				importFn: importLatepointTables,
				importName: __( 'LatePoint Import', 'astra-sites' ),
			} );
		}

		if ( latepointStatus ) {
			// Use retry logic for WPForms import (max 2 retries)
			formsStatus = await importWithRetry( {
				importFn: importForms,
				importName: __( 'WPForms Import', 'astra-sites' ),
			} );
		}

		if ( formsStatus ) {
			customizerStatus = await importWithRetry( {
				importFn: importCustomizerJson,
				importName: __( 'Customizer Import', 'astra-sites' ),
			} );
		}

		if ( customizerStatus ) {
			spectraStatus = await importWithRetry( {
				importFn: importSpectraSettings,
				importName: __( 'Spectra Settings Import', 'astra-sites' ),
			} );
		}

		if ( spectraStatus ) {
			await importSiteContent();
		}
	};

	/**
	 * Start Import Part 2.
	 */
	const importPart2 = async () => {
		let sureCartStatus = false;
		let optionsStatus = false;
		let widgetStatus = false;
		let customizationsStatus = false;
		let finalStepStatus = false;

		sureCartStatus = await importSureCartSettings();

		if ( sureCartStatus ) {
			optionsStatus = await importWithRetry( {
				importFn: importSiteOptions,
				importName: __( 'Site Options Import', 'astra-sites' ),
			} );
		}

		if ( optionsStatus ) {
			widgetStatus = await importWithRetry( {
				importFn: importWidgets,
				importName: __( 'Widgets Import', 'astra-sites' ),
			} );
		}

		if ( widgetStatus ) {
			customizationsStatus = await customizeWebsite();
		}

		if ( customizationsStatus ) {
			finalStepStatus = await importWithRetry( {
				importFn: importDone,
				importName: __( 'Final Finishings', 'astra-sites' ),
			} );
		}

		if ( finalStepStatus ) {
			generateAnalyticsLead( tryAgainCount, true, {
				id: templateId,
				page_builder: builder,
				template_type: selectedTemplateType,
			} );
		}
	};

	/**
	 * Push a single plugin onto the wp.updates install queue.
	 * Caller must invoke wp.updates.queueChecker() once after pushing all items.
	 *
	 * @param {Object} plugin
	 */
	const queueInstall = ( plugin ) => {
		wp.updates.queue.push( {
			action: 'install-plugin',
			data: {
				slug: plugin.slug,
				init: plugin.init,
				name: plugin.name,
				is_ast_request: true,
				clear_destination: true,
				ajax_nonce: astraSitesVars?._ajax_nonce,
				success() {
					dispatch( {
						type: 'plugin_installed',
						plugin,
						importStatus: sprintf(
							// translators: Plugin Name.
							__(
								'%1$s plugin installed successfully.',
								'astra-sites'
							),
							plugin.name
						),
					} );
				},
				error( err ) {
					// pluginInstallationAttempts is incremented inside the
					// plugin_install_failed reducer — single dispatch, single render.
					dispatch( {
						type: 'plugin_install_failed',
						plugin,
						error: extractPluginError(
							err,
							__( 'Installation failed.', 'astra-sites' )
						),
					} );
				},
			},
		} );
	};

	/**
	 * Install Required plugins.
	 */
	const installRequiredPlugins = () => {
		if ( notInstalledList.length <= 0 ) {
			return;
		}

		percentage += 2;
		dispatch( {
			type: 'set',
			importStatus: __( 'Installing Required Plugins.', 'astra-sites' ),
			importPercent: percentage,
		} );

		// Mark only the first plugin as 'installing' — wp.updates queue is
		// sequential, so the rest stay 'pending' and the reducer flips the
		// next one to 'installing' as each completes.
		dispatch( {
			type: 'plugin_install_started',
			plugin: notInstalledList[ 0 ],
		} );

		notInstalledList.forEach( queueInstall );
		wp.updates.queueChecker();
	};

	/**
	 * Activate Plugin
	 *
	 * @param {Object} plugin
	 */
	const activatePlugin = ( plugin ) => {
		// Already active — skip re-activation; just drain it from the queue.
		if ( pluginStatuses[ plugin.slug ]?.state === 'success' ) {
			dispatch( { type: 'plugin_activated', plugin } );
			return;
		}

		percentage += 2;
		dispatch( {
			type: 'plugin_activate_started',
			plugin,
			importStatus: sprintf(
				// translators: Plugin Name.
				__( 'Activating %1$s plugin.', 'astra-sites' ),
				plugin.name
			),
			importPercent: percentage,
		} );

		const activatePluginOptions = new FormData();
		activatePluginOptions.append(
			'action',
			'astra-sites-required_plugin_activate'
		);
		activatePluginOptions.append( 'init', plugin.init );
		activatePluginOptions.append(
			'_ajax_nonce',
			astraSitesVars?._ajax_nonce
		);
		activatePluginOptions.append( 'slug', plugin.slug );
		fetch( ajaxurl, {
			method: 'post',
			body: activatePluginOptions,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				let cloneResponse = [];
				let errorReported = false;
				try {
					const response = JSON.parse( text );
					cloneResponse = response;
					if ( response.success ) {
						// Check if this is a deprioritization response
						let deprioritizeStatus = false;
						if (
							response.data &&
							response.data.status === 'deprioritize'
						) {
							deprioritizeStatus = true;

							// Add to deferred queue
							setDeferredPlugins( ( prev ) => {
								const exists = prev.some(
									( p ) => p.slug === plugin.slug
								);
								if ( ! exists ) {
									return [
										...prev,
										{
											...plugin,
											deferReason: response.data.reason,
											retryAfter:
												response.data.retry_after,
											dependency:
												response.data.dependency,
										},
									];
								}
								return prev;
							} );
						}

						// Use reducer actions to avoid closure issues
						// The reducer uses current state, not stale closure values
						if ( deprioritizeStatus ) {
							const dependencyName =
								response.data?.dependency ||
								__( 'a required plugin', 'astra-sites' );
							dispatch( {
								type: 'plugin_deferred',
								plugin,
								importStatus: sprintf(
									/* translators: %1$s: plugin name, %2$s: dependency plugin name */
									__(
										'%1$s deferred (requires %2$s).',
										'astra-sites'
									),
									plugin.name,
									dependencyName
								),
								importPercent: percentage,
							} );
						} else {
							percentage += 2;
							dispatch( {
								type: 'plugin_activated',
								plugin,
								importStatus: sprintf(
									// translators: Plugin Name.
									__( '%1$s activated.', 'astra-sites' ),
									plugin.name
								),
								importPercent: percentage,
							} );
						}
					}
				} catch ( error ) {
					// Per-plugin failure — surface inline, don't wipe the whole screen.
					dispatch( {
						type: 'plugin_activate_failed',
						plugin,
						error: extractPluginError(
							error,
							__(
								'Activation failed (invalid response).',
								'astra-sites'
							)
						),
					} );
					errorReported = true;
				}

				if ( ! cloneResponse.success && errorReported === false ) {
					throw cloneResponse;
				}
			} )
			.catch( ( error ) => {
				// Per-plugin failure — remove from queue, surface inline.
				// pluginInstallationAttempts is incremented inside the
				// plugin_activate_failed reducer.
				dispatch( {
					type: 'plugin_activate_failed',
					plugin,
					error: extractPluginError(
						error,
						__( 'Activation failed.', 'astra-sites' )
					),
				} );
			} );
	};

	/**
	 * Check if plugin is in the required plugins list.
	 *
	 * @param {string} slug - Plugin slug to check.
	 * @return {boolean} - true if plugin is in required plugins
	 */
	const inRequiredPlugins = ( slug ) => {
		const plugins = templateResponse?.[ 'required-plugins' ] || [];
		if ( plugins?.find( ( plugin ) => plugin?.slug === slug ) ) {
			return true;
		}

		return false;
	};

	/**
	 * Import with retry logic and exponential backoff.
	 *
	 * @param {Object}   options              - Options object
	 * @param {Function} options.importFn     - Import function to retry
	 * @param {string}   options.importName   - Name for logging (default: 'Import')
	 * @param {number}   options.maxRetries   - Maximum retry attempts (default: 2)
	 * @param {number}   options.initialDelay - Initial delay in ms (default: 2000)
	 */
	const importWithRetry = async ( {
		importFn,
		importName = 'Import',
		maxRetries = 2,
		initialDelay = 2000,
	} ) => {
		for ( let attempt = 1; attempt <= maxRetries; attempt++ ) {
			const isLastAttempt = attempt === maxRetries;

			if ( attempt > 1 ) {
				dispatch( {
					type: 'set',
					importStatus: sprintf(
						// translators: %1$s: Import name, %2$d: current attempt, %3$d: max attempts.
						__( '%1$s (retry attempt %2$d/%3$d)…', 'astra-sites' ),
						importName,
						attempt - 1,
						maxRetries - 1
					),
				} );
			}

			// On last attempt, allow error reporting; suppress on earlier attempts
			const result = await importFn( ! isLastAttempt );

			// If result is false and not the last attempt, retry
			if ( result === false && ! isLastAttempt ) {
				// Calculate exponential backoff delay
				const delay = initialDelay * Math.pow( 2, attempt - 1 );

				dispatch( {
					type: 'set',
					importStatus: sprintf(
						// translators: Import name, seconds to wait.
						__(
							'%1$s encountered an error. Retrying in %2$d seconds…',
							'astra-sites'
						),
						importName,
						Math.floor( delay / 1000 )
					),
				} );

				// Wait before retry
				await new Promise( ( resolve ) =>
					setTimeout( resolve, delay )
				);

				continue;
			}

			// Either success or last attempt - return the result
			return result;
		}

		return false;
	};

	/**
	 * 1. Reset.
	 * The following steps are covered here.
	 * 		1. Settings backup file store.
	 * 		2. Reset Customizer
	 * 		3. Reset Site Options
	 * 		4. Reset Widgets
	 * 		5. Reset Forms and Terms
	 * 		6. Reset all posts
	 */
	const resetOldSite = async () => {
		if ( ! reset ) {
			return true;
		}
		percentage += 2;
		dispatch( {
			type: 'set',
			importStatus: __( 'Reseting site.', 'astra-sites' ),
			importPercent: percentage,
		} );

		let backupFileStatus = false;
		let resetCustomizerStatus = false;
		let resetWidgetStatus = false;
		let resetOptionsStatus = false;
		let reseteTermsStatus = false;
		let resetPostsStatus = false;

		/**
		 * Settings backup file store.
		 */
		backupFileStatus = await performSettingsBackup();

		/**
		 * Reset Customizer.
		 */
		if ( backupFileStatus ) {
			resetCustomizerStatus = await performResetCustomizer();
		}

		/**
		 * Reset Site Options.
		 */
		if ( resetCustomizerStatus ) {
			resetOptionsStatus = await performResetSiteOptions();
		}

		/**
		 * Reset Widgets.
		 */
		if ( resetOptionsStatus ) {
			resetWidgetStatus = await performResetWidget();
		}

		/**
		 * Reset Terms, Forms.
		 */
		if ( resetWidgetStatus ) {
			reseteTermsStatus = await performResetTermsAndForms();
		}

		/**
		 * Reset Posts.
		 */
		if ( reseteTermsStatus ) {
			resetPostsStatus = await performResetPosts();
		}

		if (
			! (
				resetCustomizerStatus &&
				resetOptionsStatus &&
				resetWidgetStatus &&
				reseteTermsStatus &&
				resetPostsStatus
			)
		) {
			return false;
		}

		percentage += 10;
		dispatch( {
			type: 'set',
			importPercent: percentage >= 50 ? 50 : percentage,
			importStatus: __( 'Reset for old website is done.', 'astra-sites' ),
		} );

		return true;
	};

	/**
	 * Reset a chunk of posts.
	 *
	 * @param {Object} chunk
	 */
	const performPostsReset = async ( chunk ) => {
		const data = new FormData();
		data.append( 'action', 'astra-sites-get_deleted_post_ids' );
		data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		dispatch( {
			type: 'set',
			importStatus: __( `Resetting posts.`, 'astra-sites' ),
		} );

		const formOption = new FormData();
		formOption.append( 'action', 'astra-sites-reset_posts' );
		formOption.append( 'ids', JSON.stringify( chunk ) );
		formOption.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		await fetch( ajaxurl, {
			method: 'post',
			body: formOption,
		} )
			.then( ( resp ) => resp.text() )
			.then( ( text ) => {
				let cloneData = [];
				let errorReported = false;
				try {
					const result = JSON.parse( text );
					cloneData = result;
					if ( result.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage >= 50 ? 50 : percentage,
						} );
					} else {
						throw result;
					}
				} catch ( error ) {
					report(
						__( 'Resetting posts failed.', 'astra-sites' ),
						'',
						error,
						'',
						'',
						text
					);

					errorReported = true;
					return false;
				}

				if ( ! cloneData.success && errorReported === false ) {
					throw cloneData.data;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Resetting posts failed.', 'astra-sites' ),
					'',
					error?.message,
					'',
					'',
					error
				);
				return false;
			} );
		return true;
	};

	/**
	 * 1.0 Perform Settings backup file stored.
	 */
	const performSettingsBackup = async () => {
		dispatch( {
			type: 'set',
			importStatus: __( 'Taking settings backup.', 'astra-sites' ),
		} );

		const customizerContent = new FormData();
		customizerContent.append( 'action', 'astra-sites-backup_settings' );
		customizerContent.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: customizerContent,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				const response = JSON.parse( text );
				if ( response.success ) {
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage,
					} );
					return true;
				}
				throw response.data;
			} )
			.catch( ( error ) => {
				report(
					__( 'Taking settings backup failed.', 'astra-sites' ),
					'',
					error?.message,
					'',
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 1.1 Perform Reset for Customizer.
	 */
	const performResetCustomizer = async () => {
		dispatch( {
			type: 'set',
			importStatus: __( 'Resetting customizer.', 'astra-sites' ),
		} );

		const customizerContent = new FormData();
		customizerContent.append(
			'action',
			'astra-sites-reset_customizer_data'
		);
		customizerContent.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: customizerContent,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const response = JSON.parse( text );
					if ( response.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__( 'Resetting customizer failed.', 'astra-sites' ),
						'',
						error?.message,
						'',
						'',
						text
					);

					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Resetting customizer failed.', 'astra-sites' ),
					'',
					error?.message,
					'',
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 1.2 Perform reset Site options
	 */
	const performResetSiteOptions = async () => {
		dispatch( {
			type: 'set',
			importStatus: __( 'Resetting site options.', 'astra-sites' ),
		} );

		const siteOptions = new FormData();
		siteOptions.append( 'action', 'astra-sites-reset_site_options' );
		siteOptions.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: siteOptions,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					report(
						__( 'Resetting site options Failed.', 'astra-sites' ),
						'',
						error?.message,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Resetting site options Failed.', 'astra-sites' ),
					'',
					error?.message,
					'',
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 1.3 Perform Reset for Widgets
	 */
	const performResetWidget = async () => {
		const widgets = new FormData();
		widgets.append( 'action', 'astra-sites-reset_widgets_data' );
		widgets.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		dispatch( {
			type: 'set',
			importStatus: __( 'Resetting widgets.', 'astra-sites' ),
		} );
		const status = await fetch( ajaxurl, {
			method: 'post',
			body: widgets,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const response = JSON.parse( text );
					if ( response.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__(
							'Resetting widgets JSON parse failed.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Resetting widgets failed.', 'astra-sites' ),
					'',
					error,
					'',
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 1.4 Reset Terms and Forms.
	 */
	const performResetTermsAndForms = async () => {
		const formOption = new FormData();
		formOption.append( 'action', 'astra-sites-reset_terms_and_forms' );
		formOption.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		dispatch( {
			type: 'set',
			importStatus: __( 'Resetting terms and forms.', 'astra-sites' ),
		} );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: formOption,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const response = JSON.parse( text );
					if ( response.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__(
							'Resetting terms and forms failed.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Resetting terms and forms failed.', 'astra-sites' ),
					'',
					error?.message,
					'',
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 1.5 Reset Posts.
	 */
	const performResetPosts = async () => {
		const data = new FormData();
		data.append( 'action', 'astra-sites-get_deleted_post_ids' );
		data.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		dispatch( {
			type: 'set',
			importStatus: __( 'Gathering posts for deletions.', 'astra-sites' ),
		} );

		let err = '';

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: data,
		} )
			.then( safeParseJson )
			.then( async ( response ) => {
				if ( response.success ) {
					const chunkArray = divideIntoChunks( 10, response.data );
					if ( chunkArray.length > 0 ) {
						for (
							let index = 0;
							index < chunkArray.length;
							index++
						) {
							await performPostsReset( chunkArray[ index ] );
						}
					}
					return true;
				}
				err = response;
				return false;
			} );

		if ( status ) {
			dispatch( {
				type: 'set',
				importStatus: __( 'Resetting posts done.', 'astra-sites' ),
			} );
		} else {
			report( __( 'Resetting posts failed.', 'astra-sites' ), '', err );
		}
		return status;
	};

	/**
	 * Parse and validate an AJAX importer response.
	 * Separates JSON parse failures from server-side errors so the real
	 * error message from PHP is preserved and surfaced to the user.
	 *
	 * @param {string} text         Raw response text from the AJAX call.
	 * @param {string} importerName Human-readable name for error context.
	 * @return {Object} The parsed response data object on success.
	 * @throws {Error} error.message contains the real failure reason.
	 *                 error.type is 'parse_error' | 'server_error'
	 */
	const parseImporterResponse = ( text, importerName ) => {
		let data;
		try {
			data = JSON.parse( text );
		} catch ( parseError ) {
			throw Object.assign(
				new Error(
					`${ importerName }: Server returned a non-JSON response.`
				),
				{ type: 'parse_error', raw: text }
			);
		}
		if ( ! data.success ) {
			throw Object.assign(
				new Error(
					data.data || `${ importerName }: Unknown server error.`
				),
				{ type: 'server_error', responseData: data.data }
			);
		}
		return data;
	};

	/**
	 * 2. Import CartFlows Flows.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic)
	 */
	const importCartflowsFlows = async ( suppressErrorReporting = false ) => {
		// Skip if CartFlows is not in the required plugins list.
		if ( ! inRequiredPlugins( 'cartflows' ) ) {
			return true;
		}

		const cartflowsUrl =
			encodeURI( templateResponse?.[ 'astra-site-cartflows-path' ] ) ||
			'';

		if ( '' === cartflowsUrl || 'null' === cartflowsUrl ) {
			return true;
		}

		dispatch( {
			type: 'set',
			importStatus: __( 'Importing CartFlows flows.', 'astra-sites' ),
		} );

		const flows = new FormData();
		flows.append( 'action', 'astra-sites-import-cartflows' );
		flows.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: flows,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'CartFlows Import' );
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing CartFlows flows failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error?.message || error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				// Suppress error reporting if flag is set (used in retry logic)
				if ( suppressErrorReporting ) {
					return false;
				}

				report(
					__( 'Importing CartFlows flows Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 2. Import Cart Abandonment Recovery data.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic)
	 */
	const importCartAbandonmentRecovery = async (
		suppressErrorReporting = false
	) => {
		// Skip if Woo Cart Abandonment Recovery is not in the required plugins list.
		if ( ! inRequiredPlugins( 'woo-cart-abandonment-recovery' ) ) {
			return true;
		}

		const wooCARUrl = encodeURI(
			templateResponse?.[ 'astra-site-cart-abandonment-recovery-path' ] ||
				''
		);

		if ( '' === wooCARUrl || 'null' === wooCARUrl ) {
			return true;
		}

		dispatch( {
			type: 'set',
			importStatus: __(
				'Importing Cart Abandonment Recovery data.',
				'astra-sites'
			),
		} );

		const bodyData = new FormData();
		bodyData.append(
			'action',
			'astra-sites-import-cart-abandonment-recovery'
		);
		bodyData.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: bodyData,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse(
						text,
						'Cart Abandonment Recovery Import'
					);
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Cart Abandonment Recovery data failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error?.message || error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				// Suppress error reporting if flag is set (used in retry logic)
				if ( suppressErrorReporting ) {
					return false;
				}

				report(
					__(
						'Importing Cart Abandonment Recovery data Failed.',
						'astra-sites'
					),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 3. Import LatePoint Tables.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic)
	 */
	const importLatepointTables = async ( suppressErrorReporting = false ) => {
		// Skip if LatePoint is not in the required plugins list.
		if ( ! inRequiredPlugins( 'latepoint' ) ) {
			return true;
		}

		const latepointUrl =
			encodeURI( templateResponse?.[ 'astra-site-latepoint-path' ] ) ||
			'';

		if ( '' === latepointUrl || 'null' === latepointUrl ) {
			return true;
		}

		dispatch( {
			type: 'set',
			importStatus: __( 'Importing LatePoint data.', 'astra-sites' ),
		} );

		const bodyData = new FormData();
		bodyData.append( 'action', 'astra-sites-import-latepoint' );
		bodyData.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: bodyData,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'LatePoint Import' );
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing LatePoint data failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error?.message || error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				// Suppress error reporting if flag is set (used in retry logic)
				if ( suppressErrorReporting ) {
					return false;
				}

				report(
					__( 'Importing LatePoint data Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 3. Import WPForms.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic)
	 */
	const importForms = async ( suppressErrorReporting = false ) => {
		// Skip if WPForms Lite is not in the required plugins list.
		if ( ! inRequiredPlugins( 'wpforms-lite' ) ) {
			return true;
		}

		const wpformsUrl =
			encodeURI( templateResponse?.[ 'astra-site-wpforms-path' ] ) || '';

		if ( '' === wpformsUrl || 'null' === wpformsUrl ) {
			return true;
		}

		dispatch( {
			type: 'set',
			importStatus: __( 'Importing forms.', 'astra-sites' ),
		} );

		const flows = new FormData();
		flows.append( 'action', 'astra-sites-import-wpforms' );
		flows.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: flows,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'WPForms Import' );
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage >= 60 ? 60 : percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing forms failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error?.message || error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				// Suppress error reporting if flag is set (used in retry logic)
				if ( suppressErrorReporting ) {
					return false;
				}

				report(
					__( 'Importing forms Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 4. Import Customizer JSON.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic).
	 */
	const importCustomizerJson = async ( suppressErrorReporting = false ) => {
		if ( ! customizerImportFlag ) {
			percentage += 5;
			dispatch( {
				type: 'set',
				importPercent: percentage >= 65 ? 65 : percentage,
			} );
			return true;
		}
		dispatch( {
			type: 'set',
			importStatus: __( 'Importing forms.', 'astra-sites' ),
		} );

		const forms = new FormData();
		forms.append( 'action', 'astra-sites-import_customizer_settings' );
		forms.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: forms,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'Customizer Import' );
					percentage += 5;
					dispatch( {
						type: 'set',
						importPercent: percentage >= 65 ? 65 : percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Customizer failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error?.message || error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				if ( suppressErrorReporting ) {
					return false;
				}
				report(
					__( 'Importing Customizer Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	/**
	 * 5. Import Site Comtent XML.
	 */
	const importSiteContent = async () => {
		if ( ! contentImportFlag ) {
			percentage += 20;
			dispatch( {
				type: 'set',
				importPercent: percentage >= 80 ? 80 : percentage,
				xmlImportDone: true,
			} );
			return true;
		}

		const wxrUrl =
			encodeURI( templateResponse?.[ 'astra-site-wxr-path' ] ) || '';
		if ( 'null' === wxrUrl || '' === wxrUrl ) {
			const errorTxt = __(
				'The XML URL for the site content is empty.',
				'astra-sites'
			);
			report(
				__( 'Importing Site Content Failed', 'astra-sites' ),
				'',
				errorTxt,
				'',
				astraSitesVars?.support_text,
				wxrUrl
			);
			return false;
		}

		dispatch( {
			type: 'set',
			importStatus: __( 'Importing Site Content.', 'astra-sites' ),
		} );

		const content = new FormData();
		content.append( 'action', 'astra-sites-import_prepare_xml' );
		content.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: content,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					percentage += 2;
					dispatch( {
						type: 'set',
						importPercent: percentage >= 80 ? 80 : percentage,
					} );
					if ( false === data.success ) {
						const errorMsg = data.data.error || data.data;
						// Use the contextual error message from server
						report(
							errorMsg,
							'',
							'',
							data.data?.code || '',
							'',
							''
						);
						return false;
					}
					importXML( data.data );

					return true;
				} catch ( error ) {
					const secondaryMessage =
						error.name === 'SyntaxError'
							? __(
									'The server returned an invalid response. This may be due to server configuration issues or plugin conflicts.',
									'astra-sites'
							  )
							: '';

					// Show preview of response for debugging
					const responsePreview =
						text.length > 200
							? text.substring( 0, 200 ) + '...'
							: text;

					report(
						__(
							'Importing Site Content failed due to parse JSON error.',
							'astra-sites'
						),
						secondaryMessage,
						error.message,
						'',
						'',
						responsePreview
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				// Enhanced network error handling
				let secondaryMessage = __(
					'Unable to connect to the server. This could be due to internet connectivity issues.',
					'astra-sites'
				);
				let solution = __(
					'Please check your internet connection and try again.',
					'astra-sites'
				);

				// Classify network errors
				if (
					error.name === 'TypeError' &&
					error.message?.includes( 'fetch' )
				) {
					secondaryMessage = __(
						'Connection failed: Failed to connect to the import server. This could be due to network issues or server problems.',
						'astra-sites'
					);
				} else if ( error.message?.includes( 'timeout' ) ) {
					secondaryMessage = __(
						'Request timeout: The import request took too long to complete. This could be due to server load or network issues.',
						'astra-sites'
					);
					solution = __(
						'Please try again. If the problem persists, try a different template.',
						'astra-sites'
					);
				}

				report(
					__( 'Importing Site Content Failed.', 'astra-sites' ),
					secondaryMessage,
					error.message || error,
					error.code || '',
					solution,
					''
				);
				return false;
			} );

		return status;
	};

	/**
	 * 6. Import Spectra Settings.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic).
	 */
	const importSpectraSettings = async ( suppressErrorReporting = false ) => {
		// Skip if Spectra is not in the required plugins list.
		if ( ! inRequiredPlugins( 'ultimate-addons-for-gutenberg' ) ) {
			return true;
		}

		const spectraSettings =
			templateResponse?.[ 'astra-site-spectra-options' ] || '';

		if ( '' === spectraSettings || 'null' === spectraSettings ) {
			return true;
		}

		dispatch( {
			type: 'set',
			importStatus: __( 'Importing Spectra Settings.', 'astra-sites' ),
		} );

		const spectra = new FormData();
		spectra.append( 'action', 'astra-sites-import_spectra_settings' );
		spectra.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: spectra,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage >= 75 ? 75 : percentage,
						} );
						return true;
					}

					// Extract meaningful error message
					const errorMsg =
						data.data?.error ||
						data.data ||
						__( 'Unknown error occurred.', 'astra-sites' );
					throw errorMsg;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					const errorText =
						error?.message ||
						error ||
						__( 'Parse error occurred.', 'astra-sites' );
					report(
						__(
							'Importing Spectra Settings failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						errorText,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				if ( suppressErrorReporting ) {
					return false;
				}
				const errorText =
					error?.message ||
					error ||
					__( 'Network error occurred.', 'astra-sites' );
				report(
					__( 'Importing Spectra Settings Failed.', 'astra-sites' ),
					'',
					errorText
				);
				return false;
			} );
		return status;
	};

	/**
	 * 7. Import Surecart Settings.
	 */
	const importSureCartSettings = async () => {
		// Skip if SureCart is not in the required plugins list.
		if ( ! inRequiredPlugins( 'surecart' ) ) {
			return true;
		}

		const sourceID =
			templateResponse?.[ 'astra-site-surecart-settings' ]?.id || '';
		const sourceCurrency =
			templateResponse?.[ 'astra-site-surecart-settings' ]?.currency ||
			'usd';
		if ( '' === sourceID || 'null' === sourceID ) {
			return true;
		}
		const surecart = new FormData();
		surecart.append( 'action', 'astra-sites-import_surecart_settings' );
		surecart.append( 'source_id', sourceID );
		surecart.append( 'source_currency', sourceCurrency );
		surecart.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: surecart,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage += 2;
						dispatch( {
							type: 'set',
							importPercent: percentage >= 75 ? 75 : percentage,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					report(
						__(
							'Importing Surecart Settings failed.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Importing Surecart Settings Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * Imports XML using EventSource.
	 *
	 * @param {JSON} data JSON object for all the content in XML
	 */
	const importXML = ( data ) => {
		// Import XML though Event Source.
		sseImport.data = data;
		sseImport.render( dispatch, percentage );

		const evtSource = new EventSource( sseImport.data.url );
		evtSource.onmessage = ( message ) => {
			const eventData = JSON.parse( message.data );
			switch ( eventData.action ) {
				case 'updateDelta':
					sseImport.updateDelta( eventData.type, eventData.delta );
					break;

				case 'complete':
					evtSource.close();
					if ( false === eventData.error ) {
						dispatch( {
							type: 'set',
							xmlImportDone: true,
						} );
					} else {
						const errorMsg =
							eventData.error ||
							astraSitesVars?.xml_import_interrupted_error;
						const solutionMsg = eventData.error
							? astraSitesVars?.process_failed_secondary
							: astraSitesVars?.xml_import_interrupted_secondary;
						report(
							astraSitesVars?.xml_import_interrupted_primary,
							'',
							errorMsg,
							'',
							solutionMsg
						);
					}
					break;
			}
		};

		evtSource.onerror = ( error ) => {
			if ( ! ( error && error?.isTrusted ) ) {
				evtSource.close();
				report(
					__(
						'Importing Site Content Failed. - Import Process Interrupted',
						'astra-sites'
					),
					'',
					astraSitesVars?.xml_import_interrupted_primary
				);
			}
		};

		evtSource.addEventListener( 'log', function ( message ) {
			const eventLogData = JSON.parse( message.data );
			let importMessage = eventLogData.message || '';
			if ( importMessage && 'info' === eventLogData.level ) {
				importMessage = importMessage.replace( /"/g, function () {
					return '';
				} );
			}

			dispatch( {
				type: 'set',
				importStatus: sprintf(
					// translators: Response importMessage
					__( 'Importing - %1$s', 'astra-sites' ),
					importMessage
				),
			} );
		} );
	};

	/**
	 * 6. Import Site Option table values.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic).
	 */
	const importSiteOptions = async ( suppressErrorReporting = false ) => {
		dispatch( {
			type: 'set',
			importStatus: __( 'Importing Site Options.', 'astra-sites' ),
		} );

		const siteOptions = new FormData();
		siteOptions.append( 'action', 'astra-sites-import_options' );
		siteOptions.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: siteOptions,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'Site Options Import' );
					percentage += 5;
					dispatch( {
						type: 'set',
						importPercent: percentage >= 90 ? 90 : percentage,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Site Options failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				if ( suppressErrorReporting ) {
					return false;
				}
				report(
					__( 'Importing Site Options Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	/**
	 * 7. Import Site Widgets.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic).
	 */
	const importWidgets = async ( suppressErrorReporting = false ) => {
		if ( ! widgetImportFlag ) {
			dispatch( {
				type: 'set',
				importPercent: 90,
			} );
			return true;
		}
		dispatch( {
			type: 'set',
			importStatus: __( 'Importing Widgets.', 'astra-sites' ),
		} );

		const widgetsData =
			templateResponse?.[ 'astra-site-widgets-data' ] || '';

		const widgets = new FormData();
		widgets.append( 'action', 'astra-sites-import_widgets' );
		widgets.append( 'widgets_data', widgetsData );
		widgets.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: widgets,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'Widgets Import' );
					dispatch( {
						type: 'set',
						importPercent: 90,
					} );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Widgets failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					return false;
				}
			} )
			.catch( ( error ) => {
				if ( suppressErrorReporting ) {
					return false;
				}
				report(
					__( 'Importing Widgets Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 8. Update the website as per the customizations selected by the user.
	 * The following steps are covered here.
	 * 		a. Update Logo
	 * 		b. Update Color Palette
	 * 		c. Update Typography
	 */
	const customizeWebsite = async () => {
		await setSiteLogo( siteLogo );
		await setColorPalettes( JSON.stringify( activePalette ) );
		await saveTypography( typography );
		return true;
	};

	/**
	 * 9. Final setup - Invoking Batch process.
	 *
	 * @param {boolean} suppressErrorReporting - If true, suppress error reporting (used by retry logic).
	 */
	const importDone = async ( suppressErrorReporting = false ) => {
		dispatch( {
			type: 'set',
			importStatus: __( 'Final finishings.', 'astra-sites' ),
		} );

		const finalSteps = new FormData();
		finalSteps.append( 'action', 'astra-sites-import_end' );
		finalSteps.append( '_ajax_nonce', astraSitesVars?._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: finalSteps,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					parseImporterResponse( text, 'Final Finishings' );
					localStorage.setItem( 'st-import-end', +new Date() );
					setTimeout( function () {
						dispatch( {
							type: 'set',
							importPercent: 100,
							importEnd: true,
						} );
					}, successMessageDelay );
					return true;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					// report() flips importError so the ErrorScreen renders.
					// Don't bump importPercent to 100 here — that would visually
					// claim success while the user sees the failure body, and
					// it triggers the "Congratulations" header path. importEnd
					// still flips so the runner halts.
					report(
						__(
							'Final finishings failed due to parse JSON error.',
							'astra-sites'
						),
						'',
						error,
						'',
						'',
						text
					);
					setTimeout( function () {
						dispatch( {
							type: 'set',
							importPercent: 100,
							importEnd: true,
						} );
					}, successMessageDelay );
					localStorage.setItem( 'st-import-end', +new Date() );
					return false;
				}
			} )
			.catch( ( error ) => {
				if ( suppressErrorReporting ) {
					return false;
				}
				report(
					__( 'Final finishings Failed.', 'astra-sites' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	// Re-queue a single failed plugin for retry.
	// For activate-failures the activatePlugin useEffect fires automatically
	// when the plugin is added back to notActivatedList. For install-failures
	// we need to push the plugin onto wp.updates.queue ourselves and mark it
	// 'installing' (the reducer's auto-advance only kicks in on completion).
	const handleRetryPlugin = ( pluginStatus ) => {
		// Capture failedAt before dispatching plugin_retry, which clears it in
		// the reducer — the branch below must read the pre-dispatch value.
		const { failedAt } = pluginStatus;
		dispatch( { type: 'plugin_retry', plugin: pluginStatus } );

		if ( failedAt === 'install' ) {
			dispatch( {
				type: 'plugin_install_started',
				plugin: pluginStatus,
			} );
			queueInstall( pluginStatus );
			wp.updates.queueChecker();
		}
	};

	// Retry all currently failed plugins that are still under the retry cap.
	// Plugins at MAX_RETRIES are excluded — they show a manual-install fallback
	// and must not be silently re-queued by this bulk action.
	const handleRetryAll = () => {
		Object.values( pluginStatuses )
			.filter(
				( s ) =>
					s.state === 'failed' && ( s.attempts || 0 ) < MAX_RETRIES
			)
			.forEach( handleRetryPlugin );
	};

	// Skip all failed optional plugins and proceed to import.
	const handleProceedWithoutOptional = () => {
		dispatch( { type: 'skip_optional_failures' } );
		// All required are already success at this point — safe to advance.
		// Clear the stale per-plugin status (e.g. "X activated.") so it doesn't
		// leak into the next-phase ImportLoader screen. Only set the transition
		// status if we haven't already advanced — otherwise we'd overwrite a
		// later phase's importStatus.
		dispatch( {
			type: 'set',
			requiredPluginsDone: true,
			...( requiredPluginsDone
				? {}
				: {
						importStatus: __( 'Preparing import…', 'astra-sites' ),
				  } ),
		} );
	};

	// Re-run the server-side plugin check. Single-flight: ignore overlapping
	// invocations whether they come from the manual Refresh CTA or the
	// background tab-focus listener.
	const runPluginCheck = () => {
		if ( awaitingPluginCheck ) {
			return;
		}
		dispatch( {
			type: 'set',
			awaitingPluginCheck: true,
		} );
		checkRequiredPlugins( storedState );
	};

	// Escape hatch: when required plugins are stuck failing, let the user
	// abandon this template and pick a different one. Cancel any pending
	// verify timer first — if ImportSite doesn't unmount on step change, the
	// timer could fire and flip requiredPluginsDone for the abandoned template.
	const handleGoBackToTemplates = () => {
		if ( pluginVerifyTimeoutRef.current ) {
			clearTimeout( pluginVerifyTimeoutRef.current );
			pluginVerifyTimeoutRef.current = null;
		}
		dispatch( { type: 'set', currentIndex: getStepIndex( 'site-list' ) } );
	};

	const preventRefresh = ( event ) => {
		if ( importPercent < 100 ) {
			event.returnValue = __(
				'Are you sure you want to cancel the site import process?',
				'astra-sites'
			);
			return event;
		}
	};

	useEffect( () => {
		// Track import step first, then update the analytics opt-in preference.
		// The analytics option update triggers a WordPress init hook that may flush
		// steps_visited to the server — doing it here ensures import is already in
		// the DB before that snapshot is taken.
		const { analytics } = starterTemplates;
		trackOnboardingStep( 'import' ).finally( () => {
			const answer = analyticsFlag ? 'yes' : 'no';
			if ( answer !== analytics ) {
				const optinAnswer = new FormData();
				optinAnswer.append( 'action', 'astra-sites-update-analytics' );
				optinAnswer.append(
					'_ajax_nonce',
					astraSitesVars?._ajax_nonce
				);
				optinAnswer.append( 'data', answer );

				fetch( ajaxurl, {
					method: 'post',
					body: optinAnswer,
				} )
					.then( safeParseJson )
					.then( ( response ) => {
						if ( response.success ) {
							starterTemplates.analytics = answer;
						}
					} );
			}
		} );
	}, [] );

	useEffect( () => {
		// Skip attaching the guard once the import is done — no point warning
		// the user about a flow that has already completed.
		if ( importPercent === 100 ) {
			return undefined;
		}
		window.addEventListener( 'beforeunload', preventRefresh ); // eslint-disable-line
		return () => {
			window.removeEventListener( 'beforeunload', preventRefresh ); // eslint-disable-line
		};
	}, [ importPercent ] );

	/**
	 * When try again button is clicked:
	 * There is a possibility that few/all the required plugins list is already installed.
	 * We cre-check the status of the required plugins here.
	 */
	useEffect( () => {
		if ( tryAgainCount > 0 ) {
			checkRequiredPlugins( storedState );
		}
	}, [ tryAgainCount ] );

	/**
	 * Start the pre import process.
	 * 		1. Install Astra Theme
	 * 		2. Install Required Plugins.
	 */
	useEffect( () => {
		/**
		 * Do not process when Import is already going on.
		 */
		if ( importStart || importEnd ) {
			return;
		}
		if ( ! importError ) {
			localStorage.setItem( 'st-import-start', +new Date() );
			percentage += 5;

			dispatch( {
				type: 'set',
				importStart: true,
				importPercent: percentage,
				importStatus: __( 'Starting Import.', 'astra-sites' ),
			} );
		}

		if ( themeActivateFlag && false === themeStatus ) {
			installAstra( storedState );
		} else {
			dispatch( {
				type: 'set',
				themeStatus: true,
			} );
		}
		installRequiredPlugins();
	}, [ templateResponse ] );

	/**
	 * Start the process only when:
	 * 		1. Required plugins are installed and activated.
	 * 		2. Astra Theme is installed
	 */
	useEffect( () => {
		if ( ! ( requiredPluginsDone && themeStatus ) ) {
			return;
		}
		// The post-activation initialization delay (STAR-1711) now happens on
		// the plugin-step screen before requiredPluginsDone flips, so by the
		// time we get here it's safe to start importPart1 without further wait.
		importPart1();
	}, [ requiredPluginsDone, themeStatus ] );

	/**
	 * Start Part 2 of the import once the XML is imported sucessfully.
	 */
	useEffect( () => {
		if ( xmlImportDone ) {
			importPart2();
		}
	}, [ xmlImportDone ] );

	// State for deferred plugins (dependency-on-another-plugin handling, e.g. WooCommerce, LearnDash).
	const [ deferredPlugins, setDeferredPlugins ] = React.useState( [] );
	// Single-flight guard around retryDeferredPlugins. Set true → false within
	// the same function call, so it never crosses a render — using a ref
	// avoids an unnecessary re-render pair.
	const retryingDeferredRef = React.useRef( false );
	// Tracks whether the post-activation initialization delay has been started
	// for this run. Plain ref (not state) so toggling it doesn't trigger renders
	// and a stale closure can't restart the timer if the effect re-fires.
	const pluginInitTimerStarted = React.useRef( false );
	// Holds the setTimeout id for the 2s "Verifying plugins…" buffer so we can
	// cancel it if the user navigates away (Back to Templates, step change)
	// before it fires — otherwise a late dispatch would overwrite importStatus
	// or flip requiredPluginsDone after the step is no longer current.
	const pluginVerifyTimeoutRef = React.useRef( null );

	/**
	 * Retry deferred plugins once their dependency has been activated.
	 */
	const retryDeferredPlugins = () => {
		if ( deferredPlugins.length === 0 || retryingDeferredRef.current ) {
			return;
		}

		retryingDeferredRef.current = true;

		// Move deferred plugins back to activation queue
		const pluginsToRetry = [ ...deferredPlugins ];
		setDeferredPlugins( [] );

		// Use reducer action so state.notActivatedList (not closure) is read at
		// dispatch time — consistent with plugin_installed/plugin_activated fix.
		dispatch( {
			type: 'plugin_retry_deferred',
			plugins: pluginsToRetry,
		} );

		retryingDeferredRef.current = false;
	};

	// This checks if all the required plugins are installed and activated.
	useEffect( () => {
		// Don't set requiredPluginsDone if we're waiting for plugin check to complete.
		// This prevents race condition in "Try Again" flow.
		if ( awaitingPluginCheck ) {
			return;
		}

		// Already advanced — late plugin XHRs can re-trigger this effect via
		// pluginStatuses changes; don't redispatch (would overwrite the current
		// phase's importStatus with "Preparing import…").
		if ( requiredPluginsDone ) {
			return;
		}

		if ( notActivatedList.length <= 0 && notInstalledList.length <= 0 ) {
			// Check if we have deferred plugins to retry
			if ( deferredPlugins.length > 0 && ! retryingDeferredRef.current ) {
				retryDeferredPlugins();
				return;
			}

			// Block progression if any required plugin is still in a failed state.
			const hasFailedRequired = Object.values( pluginStatuses ).some(
				( s ) => s.type === 'required' && s.state === 'failed'
			);
			if ( hasFailedRequired ) {
				return;
			}

			// Pause auto-advance when an optional plugin failed so the user can
			// see the Retry optional / Proceed without optional plugins CTAs.
			// Clicking either CTA transitions the optional plugin out of 'failed'
			// (to 'pending' on retry, or 'skipped' on proceed), unblocking this
			// effect on the next render.
			const hasFailedOptional = Object.values( pluginStatuses ).some(
				( s ) => s.type === 'optional' && s.state === 'failed'
			);
			if ( hasFailedOptional ) {
				return;
			}

			// All required plugins are active. Hold the plugin-step screen for
			// 2s while just-activated plugins (WooCommerce, Elementor, etc.)
			// finish wiring up their hooks server-side — without this delay,
			// importPart1 can race ahead and hit AJAX endpoints before those
			// classes register their data hooks (see STAR-1711).
			//
			// Keeping the delay here (before requiredPluginsDone flips) means
			// the "Verifying plugins…" copy shows on the PluginInstallList
			// screen rather than bleeding onto ImportLoader.
			if ( pluginInitTimerStarted.current ) {
				return;
			}
			pluginInitTimerStarted.current = true;
			dispatch( {
				type: 'set',
				importStatus: __( 'Verifying plugins…', 'astra-sites' ),
			} );
			pluginVerifyTimeoutRef.current = setTimeout( async () => {
				pluginVerifyTimeoutRef.current = null;
				// Server-side ground truth: ask WordPress whether the plugins
				// it reported as "active" are actually registered. This catches
				// cases where activation succeeded over AJAX but the plugin
				// classes weren't picked up.
				const result = await verifyPluginsBeforeImport();
				if ( result.verified ) {
					dispatch( {
						type: 'set',
						requiredPluginsDone: true,
						importStatus: __( 'Preparing import…', 'astra-sites' ),
					} );
				}
				// On failure, verifyPluginsBeforeImport repopulated
				// notInstalledList/notActivatedList; the install/activate
				// effects will re-fire and on success this effect runs again
				// with a fresh timer (reset on lists going non-empty, see
				// effect below).
			}, 2000 );
		}
	}, [
		notActivatedList.length,
		notInstalledList.length,
		deferredPlugins.length,
		awaitingPluginCheck,
		pluginStatuses,
		requiredPluginsDone,
	] );

	// Cancel the pending "Verifying plugins…" timer if this step unmounts (e.g.
	// user clicks "Back to Templates" mid-buffer). Prevents a late dispatch
	// from flipping requiredPluginsDone or overwriting importStatus after the
	// step is no longer current.
	useEffect( () => {
		return () => {
			if ( pluginVerifyTimeoutRef.current ) {
				clearTimeout( pluginVerifyTimeoutRef.current );
				pluginVerifyTimeoutRef.current = null;
			}
		};
	}, [] );

	// If verification (or any other recovery path) repopulates the install/
	// activate queues, the all-plugins-active effect must be free to re-fire
	// the init delay + verify cycle on next completion. Resetting the ref here
	// keeps it idempotent without storing the flag in reducer state.
	useEffect( () => {
		if ( notInstalledList.length > 0 || notActivatedList.length > 0 ) {
			pluginInitTimerStarted.current = false;
		}
	}, [ notInstalledList.length, notActivatedList.length ] );

	// Activate plugins one by one using the prioritized list.
	// Track the head's slug (not just length) so a swap that keeps length equal
	// — e.g. one plugin fails (drops from list) while another is re-queued —
	// still re-fires this effect for the new head.
	useEffect( () => {
		if ( notActivatedList.length > 0 ) {
			activatePlugin( notActivatedList[ 0 ] );
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ notActivatedList[ 0 ]?.slug ] );

	// After "Check Again" completes (awaitingPluginCheck flips back to false),
	// if the server still reports notInstalled plugins, kick off the install
	// queue again — otherwise the UI shows them as 'pending' forever.
	useEffect( () => {
		if ( awaitingPluginCheck ) {
			return;
		}
		if ( notInstalledList.length > 0 && wp?.updates?.queue ) {
			installRequiredPlugins();
		}
	}, [ awaitingPluginCheck ] );

	// Background auto-detect: when at least one plugin row has hit MAX_RETRIES
	// (the user is being shown the manual-install fallback), re-run the server
	// check on tab focus so users who installed the plugin in another tab don't
	// have to manually click Refresh on return. The single-flight guard inside
	// runPluginCheck prevents overlapping checks.
	useEffect( () => {
		if ( requiredPluginsDone ) {
			return undefined;
		}
		const hasMaxAttemptsReached = Object.values( pluginStatuses ).some(
			( s ) => s.state === 'failed' && ( s.attempts || 0 ) >= MAX_RETRIES
		);
		if ( ! hasMaxAttemptsReached ) {
			return undefined;
		}
		window.addEventListener( 'focus', runPluginCheck );
		return () => {
			window.removeEventListener( 'focus', runPluginCheck );
		};
	}, [ pluginStatuses, awaitingPluginCheck, requiredPluginsDone ] );

	return (
		<DefaultStep
			content={
				<div className="middle-content middle-content-import">
					<>
						{ importPercent === 100 && ! importError ? (
							<h1 className="import-done-congrats">
								{ __( 'Congratulations', 'astra-sites' ) }
								<span>{ ICONS.tada }</span>
							</h1>
						) : (
							<h1>
								{ __(
									'We are building your website…',
									'astra-sites'
								) }
							</h1>
						) }
						{ importError && (
							<div className="ist-import-process-step-wrap">
								<ErrorScreen />
							</div>
						) }
						{ ! importError && ! requiredPluginsDone && (
							<div className="ist-import-process-step-wrap">
								<PluginInstallList
									onRetryPlugin={ handleRetryPlugin }
									onRetryAll={ handleRetryAll }
									onProceedWithoutOptional={
										handleProceedWithoutOptional
									}
									onCheckAgain={ runPluginCheck }
									onGoBack={ handleGoBackToTemplates }
								/>
							</div>
						) }
						{ ! importError && requiredPluginsDone && (
							<>
								<div className="ist-import-process-step-wrap">
									<ImportLoader />
								</div>
								{ importPercent !== 100 && (
									<Lottie
										loop
										animationData={ lottieJson }
										play
										style={ {
											height: 400,
											margin: '-70px auto -90px auto',
										} }
									/>
								) }
							</>
						) }
					</>
				</div>
			}
			actions={
				<>
					<PreviousStepLink before disabled customizeStep={ true }>
						{ __( 'Back', 'astra-sites' ) }
					</PreviousStepLink>
				</>
			}
		/>
	);
};

export default ImportSite;
