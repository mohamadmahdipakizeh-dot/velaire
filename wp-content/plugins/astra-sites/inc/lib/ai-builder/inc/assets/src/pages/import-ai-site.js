import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import ImportLoaderAi from '../components/import-loader-ai';
import sseImport from '../utils/import-site/sse-import';
import {
	installAstra,
	divideIntoChunks,
	checkRequiredPlugins,
	checkFileSystemPermissions,
	getAiDemo,
	setSiteLogo,
	setColorPalettes,
	setSiteTitle,
	saveTypography,
	setSiteLanguage,
	showErrorToast,
	generateAnalyticsLead,
} from '../utils/import-site/import-utils';
const { reportError, supportLink } = aiBuilderVars;
const successMessageDelay = 8000; // 8 seconds delay for fully assets load.
import { STORE_KEY } from '../store';
import ErrorModel from '../components/error-model';
import { stepNextButtonClick, TOTAL_STEPS, useNavigateSteps } from '../router';
import { SITE_CREATION_STATUS_CODES, getLocalStorageItem } from '../helpers';
import FeatureCarousel from '../components/feature-carousel';
import ExitConfirmationPopover from '../components/exit-confirmation-popover';

const RANDOM_FINAL_FINISHING_MESSAGES = [
	__( 'Double-checking for grammar and spelling errors…', 'ai-builder' ),
	__( 'Finalizing setup and configurations…', 'ai-builder' ),
	__( `Crossing the t's and dotting the i's…`, 'ai-builder' ),
	__( 'Reviewing for any last-minute tweaks…', 'ai-builder' ),
	__( 'Almost there! Just a few more finishing touches…', 'ai-builder' ),
	__( 'Your website is almost ready.', 'ai-builder' ),
	__( "It's taking longer than usual. Please bear with us!", 'ai-builder' ),
];

function* getMessage() {
	let msgIndx = 0;
	while ( true ) {
		yield RANDOM_FINAL_FINISHING_MESSAGES[
			msgIndx++ % RANDOM_FINAL_FINISHING_MESSAGES.length
		];
	}
}

const GradientProgressRing = ( { percent } ) => {
	const radius = 30;
	const circumference = 2 * Math.PI * radius;
	const offset = circumference * ( 1 - percent / 100 );

	return (
		<div className="relative grid place-items-center">
			<svg width="68" height="68" viewBox="0 0 68 68">
				<defs>
					<linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stopColor="#B809A7" />
						<stop offset="46.88%" stopColor="#E90B76" />
						<stop offset="100%" stopColor="#FC8536" />
					</linearGradient>
				</defs>
				<circle
					cx="34"
					cy="34"
					r={ radius }
					fill="none"
					stroke="#e0e4ec"
					strokeWidth="6"
				/>
				<circle
					cx="34"
					cy="34"
					r={ radius }
					fill="none"
					stroke="url(#ring-grad)"
					strokeWidth="6"
					strokeLinecap="round"
					strokeDasharray={ circumference }
					strokeDashoffset={ offset }
					transform="rotate(-90 34 34)"
					className="transition-[stroke-dashoffset] duration-[600ms]"
					style={ {
						transitionTimingFunction: 'cubic-bezier(.16,1,.3,1)',
					} }
				/>
			</svg>
			<span className="absolute text-sm font-bold text-[#16182a]">
				{ Math.round( percent ) }%
			</span>
		</div>
	);
};

// Client-side safety net: if no new progress step arrives within this window we
// treat the build as stalled, stop polling and surface a recoverable failure.
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

const ImportAiSite = () => {
	const { nextStep } = useNavigateSteps();

	const [ , setShowProgressBar ] = useState( true );
	const [ isReadyForImport, setIsReadyForImport ] = useState( false );
	const [ isFetchingStatus, setIsFetchingStatus ] = useState( false );

	const {
		websiteInfo,
		aiStepData: {
			businessName,
			selectedTemplate,
			selectedImages,
			siteLanguageList,
			siteLanguage,
			businessContact,
			businessDetails,
			businessType,
			keywords,
			templateList,
		},
		aiSiteLogo,
		aiSiteTitleVisible,
		aiActiveTypography,
		aiActivePallette,
		siteFeatures,
		siteFeaturesData,
	} = useSelect( ( select ) => {
		const {
			getWebsiteInfo,
			getAIStepData,
			getSiteLogo,
			getSiteTitleVisible,
			getActiveTypography,
			getActiveColorPalette,
			getSiteFeatures,
			getSiteFeaturesData,
		} = select( STORE_KEY );
		return {
			websiteInfo: getWebsiteInfo(),
			aiStepData: getAIStepData(),
			aiSiteLogo: getSiteLogo(),
			aiSiteTitleVisible: getSiteTitleVisible(),
			aiActiveTypography: getActiveTypography(),
			aiActivePallette: getActiveColorPalette(),
			siteFeatures: getSiteFeatures(),
			siteFeaturesData: getSiteFeaturesData(),
		};
	}, [] );

	const {
		importPercent,
		templateResponse,
		reset,
		themeStatus,
		importError,
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
		pluginInstallationAttempts,
		importErrorMessages,
		isCreationFailure,
		creditAutoRestore,
		templateId,
	} = useSelect( ( select ) => {
		const { getImportSiteProgressData } = select( STORE_KEY );
		return {
			...getImportSiteProgressData(),
		};
	}, [] );
	const { updateImportAiSiteData: dispatch, setWebsiteInfoAIStep } =
		useDispatch( STORE_KEY );

	const percentage = useRef( importPercent );
	// Timestamp of the last forward progress; drives the stall guard in fetchImportStatus.
	const lastProgressAtRef = useRef( Date.now() );
	// Last status code seen. The status endpoint re-emits the current code on every
	// poll, so the stall guard is only refreshed when the code actually changes.
	const lastStatusCodeRef = useRef( null );
	const randomMessage = useMemo( getMessage, [] );

	let currentStep = 0;

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
			importError: true,
			importErrorMessages: {
				primaryText: primary,
				secondaryText: secondary,
				errorCode: code,
				errorText:
					typeof text === 'string' ? text : JSON.stringify( text ),
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
				id: templateId,
				page_builder: stepsData?.pageBuilder,
				template_type: stepsData?.selectedTemplateIsPremium
					? 'premium'
					: 'free',
				error,
			} );
		}
		if ( ! reportError ) {
			return;
		}
		const reportErr = new FormData();
		reportErr.append( 'action', 'astra-sites-report_error' );
		reportErr.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );
		reportErr.append( 'type', 'ai-builder' );
		reportErr.append( 'page_builder', stepsData?.pageBuilder );
		reportErr.append(
			'template_type',
			stepsData?.selectedTemplateIsPremium ? 'premium' : 'free'
		);

		reportErr.append(
			'local_storage',
			JSON.stringify(
				getLocalStorageItem( 'ai-builder-onboarding-details' )
			)
		);
		reportErr.append( 'error', error );
		reportErr.append( 'id', templateId );
		reportErr.append( 'plugins', JSON.stringify( requiredPlugins ) );
		fetch( ajaxurl, {
			method: 'post',
			body: reportErr,
		} );
	};

	const customizeWebsite = async () => {
		const languageItem = siteLanguageList.find(
			( item ) => item.code === siteLanguage
		);
		await setSiteLogo( aiSiteLogo );
		await setColorPalettes( JSON.stringify( aiActivePallette ) );
		await setSiteTitle( businessName, aiSiteTitleVisible );
		await saveTypography( aiActiveTypography );
		await setSiteLanguage( languageItem?.[ 'wordpress-code' ] ?? 'en_US' );
	};

	const { stepsData } = useSelect( ( select ) => {
		const { getAIStepData } = select( STORE_KEY );

		return {
			stepsData: getAIStepData(),
		};
	}, [] );

	/**
	 * Retry wrapper for import steps that can transiently return non-JSON
	 * (e.g. server timeout returning HTML). importFn must accept a
	 * suppressErrorReporting boolean as its first argument.
	 *
	 * @param  root0
	 * @param  root0.importFn
	 * @param  root0.importName
	 * @param  root0.maxRetries
	 * @param  root0.initialDelay
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
					importStatus: sprintf(
						// translators: %1$s: Import name, %2$d: current attempt, %3$d: max attempts.
						__( '%1$s (retry attempt %2$d/%3$d)…', 'ai-builder' ),
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
					importStatus: sprintf(
						// translators: Import name, seconds to wait.
						__(
							'%1$s encountered an error. Retrying in %2$d seconds…',
							'ai-builder'
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
	 * Start Import Part 1.
	 */
	const importPart1 = async () => {
		let resetStatus = false;
		let customizerStatus = false;
		let spectraStatus = false;
		let sureCartStatus = false;
		let imageDownloadStatus = false;

		resetStatus = await resetOldSite();

		if ( resetStatus ) {
			imageDownloadStatus = await downloadImages();
		}

		if ( imageDownloadStatus ) {
			customizerStatus = await importWithRetry( {
				importFn: importCustomizerJson,
				importName: __( 'Customizer Import', 'ai-builder' ),
			} );
		}

		if ( customizerStatus ) {
			spectraStatus = await importWithRetry( {
				importFn: importSpectraSettings,
				importName: __( 'Spectra Settings Import', 'ai-builder' ),
			} );
		}

		if ( spectraStatus ) {
			sureCartStatus = await importSureCartSettings();
		}

		if ( sureCartStatus ) {
			await importSiteContent();
		}
	};

	/**
	 * Start Import Part 2.
	 */
	const importPart2 = async () => {
		let optionsStatus = false;
		let widgetStatus = false;
		let finalStepStatus = false;
		let gtReplaceBatch = false;
		let imagesReplaceBatch = false;
		let setSiteOptions = false;

		optionsStatus = await importWithRetry( {
			importFn: importSiteOptions,
			importName: __( 'Site Options Import', 'ai-builder' ),
		} );

		if ( optionsStatus ) {
			widgetStatus = await importWithRetry( {
				importFn: importWidgets,
				importName: __( 'Widgets Import', 'ai-builder' ),
			} );
		}

		if ( widgetStatus ) {
			gtReplaceBatch = await gtBatch();
		}

		if ( gtReplaceBatch ) {
			imagesReplaceBatch = await replaceImagebatch();
		}

		if ( imagesReplaceBatch ) {
			finalStepStatus = await importWithRetry( {
				importFn: importDone,
				importName: __( 'Final Finishings', 'ai-builder' ),
			} );
		}

		if ( finalStepStatus ) {
			setSiteOptions = await waitForFullMigration();
		}

		if ( setSiteOptions ) {
			await importSuccess();

			generateAnalyticsLead( tryAgainCount, true, {
				id: templateId,
				page_builder: stepsData?.pageBuilder,
				template_type: stepsData?.selectedTemplateIsPremium
					? 'premium'
					: 'free',
			} );
		}
	};

	/**
	 * Import Success.
	 */
	const importSuccess = async () => {
		const data = new FormData();
		data.append( 'action', 'astra-sites-import_success' );
		data.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: data,
		} )
			.then( ( response ) => response.json() )
			.then( async ( response ) => {
				if ( response.success ) {
					return true;
				}
				return false;
			} );

		return status;
	};

	/**
	 * Install Required plugins.
	 */
	const installRequiredPlugins = () => {
		// Install Bulk.
		if ( notInstalledList.length <= 0 ) {
			dispatch( {
				requiredPluginsDone: true,
			} );
			return;
		}

		percentage.current += 2;
		dispatch( {
			importStatus: __( 'Installing Required Plugins.', 'ai-builder' ),
			importPercent: percentage.current,
		} );

		const copiedList = [ ...notInstalledList ];

		notInstalledList.forEach( ( plugin ) => {
			wp.updates.queue.push( {
				action: 'install-plugin', // Required action.
				data: {
					slug: plugin.slug,
					init: plugin.init,
					name: plugin.name,
					clear_destination: true,
					ajax_nonce: aiBuilderVars._ajax_nonce,
					success() {
						dispatch( {
							importStatus: sprintf(
								// translators: Plugin Name.
								__(
									'%1$s plugin installed successfully.',
									'ai-builder'
								),
								plugin.name
							),
						} );

						const inactiveList = [ ...notActivatedList ];
						inactiveList.push( plugin );

						dispatch( {
							notActivatedList: inactiveList,
						} );
						const notInstalledPluginList = copiedList;
						notInstalledPluginList.forEach(
							( singlePlugin, index ) => {
								if ( singlePlugin.slug === plugin.slug ) {
									notInstalledPluginList.splice( index, 1 );
								}
							}
						);
						dispatch( {
							notInstalledList: notInstalledPluginList,
						} );
					},
					error( err ) {
						dispatch( {
							pluginInstallationAttempts:
								pluginInstallationAttempts + 1,
						} );
						let errText = err;
						if ( err && undefined !== err.errorMessage ) {
							errText = err.errorMessage;
							if ( undefined !== err.errorCode ) {
								errText = err.errorCode + ': ' + errText;
							}
						}
						report(
							sprintf(
								// translators: Plugin Name.
								__(
									'Could not install the plugin - %s',
									'ai-builder'
								),
								plugin.name
							),
							'',
							errText,
							'',
							'',
							err
						);
					},
				},
			} );
		} );

		// Required to set queue.
		wp.updates.queueChecker();
	};

	/**
	 * Activate Plugin
	 *
	 * @param {Object} plugin
	 */
	const activatePlugin = ( plugin ) => {
		percentage.current += 2;
		dispatch( {
			importStatus: sprintf(
				// translators: Plugin Name.
				__( 'Activating %1$s plugin.', 'ai-builder' ),
				plugin.name
			),
			importPercent: percentage.current,
		} );

		const activatePluginOptions = new FormData();
		activatePluginOptions.append(
			'action',
			'astra-sites-required_plugin_activate'
		);
		activatePluginOptions.append( 'init', plugin.init );
		activatePluginOptions.append(
			'_ajax_nonce',
			aiBuilderVars._ajax_nonce
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
						const notActivatedPluginList = [ ...notActivatedList ];
						notActivatedPluginList.forEach(
							( singlePlugin, index ) => {
								if ( singlePlugin.slug === plugin.slug ) {
									notActivatedPluginList.splice( index, 1 );
								}
							}
						);
						dispatch( {
							notActivatedList: notActivatedPluginList,
						} );
						percentage.current += 2;
						dispatch( {
							importStatus: sprintf(
								// translators: Plugin Name.
								__( '%1$s activated.', 'ai-builder' ),
								plugin.name
							),
							importPercent: percentage.current,
						} );
					}
				} catch ( error ) {
					report(
						sprintf(
							// translators: Plugin name.
							__(
								`JSON_Error: Could not activate the required plugin - %1$s.`,
								'ai-builder'
							),
							plugin.name
						),
						'',
						error,
						'',
						sprintf(
							// translators: %1$s is the opening <a> tag with the URL, %2$s is the closing </a> tag.
							__(
								'%1$sRead article%2$s to resolve the issue and continue importing the template.',
								'ai-builder'
							),
							'<a href="https://wpastra.com/docs/enable-debugging-in-wordpress/#how-to-use-debugging" target="_blank">',
							'</a>'
						),
						text
					);

					errorReported = true;
				}

				if ( ! cloneResponse.success && errorReported === false ) {
					throw cloneResponse;
				}
			} )
			.catch( ( error ) => {
				dispatch( {
					pluginInstallationAttempts: pluginInstallationAttempts + 1,
				} );
				report(
					sprintf(
						// translators: Plugin name.
						__(
							`Could not activate the required plugin - %1$s.`,
							'ai-builder'
						),
						plugin.name
					),
					'',
					error?.data?.message,
					'',
					sprintf(
						// translators: %1$s is the opening <a> tag, %2$s is the closing </a> tag.
						__(
							'%1$sRead article%2$s to resolve the issue and continue importing the template.',
							'ai-builder'
						),
						'<a href="https://wpastra.com/docs/enable-debugging-in-wordpress/#how-to-use-debugging" target="_blank">',
						'</a>'
					),
					error
				);
			} );
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
		percentage.current += 2;
		dispatch( {
			importStatus: __( 'Resetting site.', 'ai-builder' ),
			importPercent: percentage.current,
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

		percentage.current += 10;
		dispatch( {
			importPercent: percentage.current >= 50 ? 50 : percentage.current,
			importStatus: __( 'Reset for old website is done.', 'ai-builder' ),
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
		data.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		dispatch( {
			importStatus: __( `Resetting posts.`, 'ai-builder' ),
		} );

		const formOption = new FormData();
		formOption.append( 'action', 'astra-sites-reset_posts' );
		formOption.append( 'ids', JSON.stringify( chunk ) );
		formOption.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

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
						percentage.current += 2;
						dispatch( {
							importPercent:
								percentage.current >= 50
									? 50
									: percentage.current,
						} );
					} else {
						throw result;
					}
				} catch ( error ) {
					report(
						__( 'Resetting posts failed.', 'ai-builder' ),
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
					__( 'Resetting posts failed.', 'ai-builder' ),
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
			importStatus: __( 'Taking settings backup.', 'ai-builder' ),
		} );

		const customizerContent = new FormData();
		customizerContent.append( 'action', 'astra-sites-backup_settings' );
		customizerContent.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: customizerContent,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				const response = JSON.parse( text );
				if ( response.success ) {
					percentage.current += 2;
					dispatch( {
						importPercent: percentage.current,
					} );
					return true;
				}
				throw response.data;
			} )
			.catch( ( error ) => {
				report(
					__( 'Taking settings backup failed.', 'ai-builder' ),
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
			importStatus: __( 'Resetting customizer.', 'ai-builder' ),
		} );

		const customizerContent = new FormData();
		customizerContent.append(
			'action',
			'astra-sites-reset_customizer_data'
		);
		customizerContent.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: customizerContent,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const response = JSON.parse( text );
					if ( response.success ) {
						percentage.current += 2;
						dispatch( {
							importPercent: percentage.current,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__( 'Resetting customizer failed.', 'ai-builder' ),
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
					__( 'Resetting customizer failed.', 'ai-builder' ),
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
			importStatus: __( 'Resetting site options.', 'ai-builder' ),
		} );

		const siteOptions = new FormData();
		siteOptions.append( 'action', 'astra-sites-reset_site_options' );
		siteOptions.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: siteOptions,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current += 2;
						dispatch( {
							importPercent: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					report(
						__( 'Resetting site options Failed.', 'ai-builder' ),
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
					__( 'Resetting site options Failed.', 'ai-builder' ),
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
		widgets.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		dispatch( {
			importStatus: __( 'Resetting widgets.', 'ai-builder' ),
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
						percentage.current += 2;
						dispatch( {
							importPercent: percentage.current,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__(
							'Resetting widgets JSON parse failed.',
							'ai-builder'
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
					__( 'Resetting widgets failed.', 'ai-builder' ),
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
		formOption.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		dispatch( {
			importStatus: __( 'Resetting terms and forms.', 'ai-builder' ),
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
						percentage.current += 2;
						dispatch( {
							importPercent: percentage.current,
						} );
						return true;
					}
					throw response.data;
				} catch ( error ) {
					report(
						__( 'Resetting terms and forms failed.', 'ai-builder' ),
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
					__( 'Resetting terms and forms failed.', 'ai-builder' ),
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
		data.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		dispatch( {
			importStatus: __( 'Gathering posts for deletions.', 'ai-builder' ),
		} );

		let err = '';

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: data,
		} )
			.then( ( response ) => response.json() )
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
				importStatus: __( 'Resetting posts done.', 'ai-builder' ),
			} );
		} else {
			showErrorToast(
				__( 'Resetting posts failed.', 'ai-builder' ),
				err
			);
		}
		return status;
	};

	const importCustomizerJson = async ( suppressErrorReporting = false ) => {
		if ( ! customizerImportFlag ) {
			percentage.current += 5;
			dispatch( {
				importPercent:
					percentage.current >= 65 ? 65 : percentage.current,
			} );
			return true;
		}
		dispatch( {
			importStatus: __( 'Importing forms.', 'ai-builder' ),
		} );

		const forms = new FormData();
		forms.append( 'action', 'astra-sites-import_customizer_settings' );
		forms.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: forms,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current += 5;
						dispatch( {
							importPercent:
								percentage.current >= 65
									? 65
									: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Customizer failed due to parse JSON error.',
							'ai-builder'
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
					__( 'Importing Customizer Failed.', 'ai-builder' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	const downloadImages = async () => {
		for ( let index = 0; index < selectedImages.length; index++ ) {
			const formData = new FormData();
			formData.append( 'action', 'astra-sites-download_image' );
			formData.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );
			formData.append( 'index', index );
			try {
				dispatch( {
					importStatus: sprintf(
						//translators: %s: Image number.
						__( 'Downloading Image %s', 'ai-builder' ),
						index + 1
					),
				} );

				const response = await fetch( ajaxurl, {
					method: 'POST',
					body: formData,
				} );

				const data = await response.json();

				if ( ! data.success ) {
					report(
						__( 'Downloading images failed.', 'ai-builder' ),
						'',
						''
					);
				}
			} catch ( error ) {
				showErrorToast(
					__( 'Downloading images failed.', 'ai-builder' ),
					error
				);
			}
		}

		return true;
	};

	/**
	 * 5. Import Site Content XML.
	 */
	const importSiteContent = async () => {
		if ( ! contentImportFlag ) {
			percentage.current += 20;
			dispatch( {
				importPercent:
					percentage.current >= 78 ? 78 : percentage.current,
				xmlImportDone: true,
			} );
			return true;
		}

		dispatch( {
			importStatus: __( 'Importing Site Content.', 'ai-builder' ),
		} );

		const wxr = await apiFetch( {
			path: 'zipwp/v1/wxr',
			method: 'POST',
			data: {
				template: selectedTemplate,
				business_name: businessName,
			},
		} );
		if ( wxr.success ) {
			importXML( wxr.data );
		} else {
			report(
				'Importing Site Content Failed.',
				'',
				JSON.stringify( wxr.data ?? wxr, null, 4 )
			);
		}

		return true;
	};

	/**
	 * 6. Import Spectra Settings.
	 *
	 * @param  suppressErrorReporting
	 */
	const importSpectraSettings = async ( suppressErrorReporting = false ) => {
		const spectraSettings =
			templateResponse[ 'astra-site-spectra-options' ] || '';

		if (
			'' === spectraSettings ||
			'null' === spectraSettings ||
			spectraSettings?.length === 0
		) {
			return true;
		}

		dispatch( {
			importStatus: __( 'Importing Spectra Settings.', 'ai-builder' ),
		} );

		const spectra = new FormData();
		spectra.append( 'action', 'astra-sites-import_spectra_settings' );
		spectra.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: spectra,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current =
							percentage.current < 70
								? 70
								: percentage.current + 2;
						dispatch( {
							importPercent:
								percentage.current >= 70
									? 70
									: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Spectra Settings failed due to parse JSON error.',
							'ai-builder'
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
					__( 'Importing Spectra Settings Failed.', 'ai-builder' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	/**
	 * 7. Import Surecart Settings.
	 */
	const importSureCartSettings = async () => {
		const sourceID =
			templateResponse?.[ 'astra-site-surecart-settings' ]?.id || '';
		const sourceCurrency =
			templateResponse?.[ 'astra-site-surecart-settings' ]?.currency ||
			'usd';

		const surecart = new FormData();
		surecart.append( 'action', 'astra-sites-import_surecart_settings' );
		surecart.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		if ( '' === sourceID || 'null' === sourceID ) {
			const enabledFeatures = siteFeatures
				.filter( ( feature ) => feature?.enabled )
				.map( ( feature ) => feature?.id );
			if (
				enabledFeatures?.includes( 'ecommerce' ) &&
				siteFeaturesData?.ecommerce_type === 'surecart'
			) {
				surecart.append( 'create_account', true );
			} else {
				return true;
			}
		}

		surecart.append( 'source_id', sourceID );
		surecart.append( 'source_currency', sourceCurrency );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: surecart,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current =
							percentage.current < 75
								? 75
								: percentage.current + 2;
						dispatch( {
							importPercent:
								percentage.current >= 75
									? 75
									: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					report(
						__(
							'Importing Surecart Settings failed.',
							'ai-builder'
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
					__( 'Importing Surecart Settings Failed.', 'ai-builder' ),
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
		sseImport.render( dispatch, percentage.current );

		// A closed stream makes EventSource reconnect automatically — track
		// liveness so a dead server-side import doesn't leave it reconnecting
		// forever without ever surfacing an error.
		let lastMessageTime = Date.now();
		let reconnectErrorCount = 0;
		const MAX_RECONNECT_ERRORS = 20;
		const STALL_TIMEOUT = 3 * 60 * 1000;

		const evtSource = new EventSource( sseImport.data.url );
		evtSource.onmessage = ( message ) => {
			lastMessageTime = Date.now();
			reconnectErrorCount = 0;
			const eventData = JSON.parse( message.data );
			switch ( eventData.action ) {
				case 'updateDelta':
					sseImport.updateDelta( eventData.type, eventData.delta );
					break;

				case 'in_progress':
					// Another request is still running the import — keep waiting.
					dispatch( {
						importStatus: __(
							'Import already in progress…',
							'ai-builder'
						),
					} );
					break;

				case 'complete':
					// Close in both outcomes — leaving the stream open after an
					// error would auto-reconnect against the finished import.
					evtSource.close();
					if ( false === eventData.error ) {
						dispatch( {
							xmlImportDone: true,
						} );
					} else {
						report(
							aiBuilderVars.xml_import_interrupted_primary,
							'',
							aiBuilderVars.xml_import_interrupted_error,
							'',
							aiBuilderVars.xml_import_interrupted_secondary
						);
					}
					break;
			}
		};

		evtSource.onerror = ( error ) => {
			reconnectErrorCount++;
			const stalled = Date.now() - lastMessageTime > STALL_TIMEOUT;
			if (
				reconnectErrorCount > MAX_RECONNECT_ERRORS ||
				stalled ||
				! ( error && error?.isTrusted )
			) {
				evtSource.close();
				report(
					__(
						'Importing Site Content Failed. - Import Process Interrupted',
						'ai-builder'
					),
					'',
					error
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
				importStatus: sprintf(
					// translators: Response importMessage
					__( 'Importing - %1$s', 'ai-builder' ),
					importMessage
				),
			} );
		} );
	};

	/**
	 * 6. Import Site Option table values.
	 *
	 * @param  suppressErrorReporting
	 */
	const importSiteOptions = async ( suppressErrorReporting = false ) => {
		dispatch( {
			importStatus: __( 'Importing Site Options.', 'ai-builder' ),
		} );

		const siteOptions = new FormData();
		siteOptions.append( 'action', 'astra-sites-import_options' );
		siteOptions.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: siteOptions,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current = 80;
						dispatch( {
							importPercent: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Site Options failed due to parse JSON error.',
							'ai-builder'
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
					__( 'Importing Site Options Failed.', 'ai-builder' ),
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
	 * @param  suppressErrorReporting
	 */
	const importWidgets = async ( suppressErrorReporting = false ) => {
		if ( ! widgetImportFlag ) {
			percentage.current += 3;
			dispatch( {
				importPercent:
					percentage.current >= 83 ? 83 : percentage.current,
			} );
			return true;
		}
		dispatch( {
			importStatus: __( 'Importing Widgets.', 'ai-builder' ),
		} );

		const widgetsData = templateResponse[ 'astra-site-widgets-data' ] || '';

		const widgets = new FormData();
		widgets.append( 'action', 'astra-sites-import_widgets' );
		widgets.append( 'widgets_data', widgetsData );
		widgets.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: widgets,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						percentage.current += 2;
						dispatch( {
							importPercent:
								percentage.current >= 85
									? 85
									: percentage.current,
						} );
						return true;
					}
					throw data.data;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Importing Widgets failed due to parse JSON error.',
							'ai-builder'
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
					__( 'Importing Widgets Failed.', 'ai-builder' ),
					'',
					error
				);
				return false;
			} );
		return status;
	};

	const gtBatch = async () => {
		dispatch( {
			importStatus: __( 'Processing content for pages.', 'ai-builder' ),
		} );

		const finalSteps = new FormData();
		finalSteps.append( 'action', 'astra-sites-page_builder_batch' );
		finalSteps.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: finalSteps,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						setTimeout( function () {
							percentage.current =
								percentage.current < 90
									? 90
									: percentage.current;
							dispatch( {
								importPercent:
									percentage.current >= 90
										? 90
										: percentage.current,
							} );
						}, successMessageDelay );

						return true;
					}
					throw data.data;
				} catch ( error ) {
					report(
						__( 'Batch process failed.', 'ai-builder' ),
						'',
						error,
						'',
						'',
						text
					);
					setTimeout( function () {
						percentage.current =
							percentage.current > 90
								? 90
								: percentage.current + 1;
						dispatch( {
							importPercent: percentage.current,
						} );
					}, successMessageDelay );

					return false;
				}
			} )
			.catch( ( error ) => {
				report(
					__( 'Batch process failed.', 'ai-builder' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	const replaceImagebatch = async () => {
		const steps = [
			{
				step: 'pages',
				status: __( 'Replacing images in pages.', 'ai-builder' ),
				errorMsg: __(
					'Image replacement in pages failed.',
					'ai-builder'
				),
			},
			{
				step: 'posts',
				status: __( 'Replacing images in posts.', 'ai-builder' ),
				errorMsg: __(
					'Image replacement in posts failed.',
					'ai-builder'
				),
			},
			{
				step: 'customizer',
				status: __( 'Updating customizer images.', 'ai-builder' ),
				errorMsg: __(
					'Customizer image replacement failed.',
					'ai-builder'
				),
			},
			{
				step: 'cleanup',
				status: __( 'Cleaning up temporary data.', 'ai-builder' ),
				errorMsg: __( 'Image cleanup failed.', 'ai-builder' ),
			},
		];

		for ( const { step, status, errorMsg } of steps ) {
			dispatch( {
				importStatus: status,
			} );

			const formData = new FormData();
			formData.append( 'action', 'astra-sites-image_replacement_batch' );
			formData.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );
			formData.append( 'step', step );

			const result = await fetch( ajaxurl, {
				method: 'post',
				body: formData,
			} )
				.then( ( response ) => response.text() )
				.then( ( text ) => {
					try {
						const data = JSON.parse( text );
						if ( data.success ) {
							return true;
						}
						throw data.data;
					} catch ( error ) {
						report( errorMsg, '', error, '', '', text );
						return false;
					}
				} )
				.catch( ( error ) => {
					report( errorMsg, '', error );
					return false;
				} );

			if ( ! result ) {
				setTimeout( function () {
					percentage.current =
						percentage.current > 90 ? 90 : percentage.current + 1;
					dispatch( {
						importPercent: percentage.current,
					} );
				}, successMessageDelay );

				return false;
			}
		}

		setTimeout( function () {
			percentage.current =
				percentage.current < 90 ? 90 : percentage.current;
			dispatch( {
				importPercent:
					percentage.current >= 90 ? 90 : percentage.current,
			} );
		}, successMessageDelay );

		return true;
	};

	/**
	 * 9. Final setup - Invoking Batch process.
	 *
	 * @param  suppressErrorReporting
	 */
	const importDone = async ( suppressErrorReporting = false ) => {
		dispatch( {
			importStatus: __( 'Final finishing.', 'ai-builder' ),
		} );

		const finalSteps = new FormData();
		finalSteps.append( 'action', 'astra-sites-import_end' );
		finalSteps.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );

		const status = await fetch( ajaxurl, {
			method: 'post',
			body: finalSteps,
		} )
			.then( ( response ) => response.text() )
			.then( ( text ) => {
				try {
					const data = JSON.parse( text );
					if ( data.success ) {
						localStorage.setItem( 'st-import-end', +new Date() );
						setTimeout( function () {
							percentage.current =
								percentage.current < 90
									? 90
									: percentage.current;
							dispatch( {
								importPercent:
									percentage.current >= 90
										? 90
										: percentage.current,
							} );
						}, successMessageDelay );

						return true;
					}
					throw data.data;
				} catch ( error ) {
					if ( suppressErrorReporting ) {
						return false;
					}
					report(
						__(
							'Final finishing failed due to parse JSON error.',
							'ai-builder'
						),
						'',
						error,
						'',
						'',
						text
					);
					setTimeout( function () {
						percentage.current =
							percentage.current > 90
								? 90
								: percentage.current + 1;
						dispatch( {
							importPercent: percentage.current,
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
					__( 'Final finishing Failed.', 'ai-builder' ),
					'',
					error
				);
				return false;
			} );

		return status;
	};

	const waitForFullMigration = async () => {
		try {
			const randomToken = ( Math.random() * 200 )?.toString(); // to avoid response caching
			const response = await apiFetch( {
				path: `zipwp/v1/migration-status?uuid=${ websiteInfo.uuid }&token=${ randomToken }`,
				method: 'GET',
				headers: {
					'X-WP-Nonce': aiBuilderVars.rest_api_nonce,
					_ajax_nonce: aiBuilderVars._ajax_nonce,
				},
			} );

			if ( response?.data?.data === 'yes' ) {
				// Save customizations.
				await customizeWebsite();

				dispatch( {
					importPercent: 100,
					importEnd: true,
				} );

				stepNextButtonClick( {
					stepNumber: 8,
					slug: 'building-website',
				} );

				setShowProgressBar( false );
				return true;
			} else if ( response?.data?.data === 'no' ) {
				percentage.current += 2;
				dispatch( {
					importPercent:
						percentage.current >= 98 ? 98 : percentage.current,
					importStatus: randomMessage.next()?.value,
				} );
				setTimeout( () => {
					waitForFullMigration();
				}, 10000 );
			}
		} catch ( error ) {
			percentage.current += 2;
			dispatch( {
				importPercent:
					percentage.current >= 98 ? 98 : percentage.current,
				importStatus: randomMessage.next()?.value,
			} );
			setTimeout( () => {
				waitForFullMigration();
			}, 10000 );
		}
	};

	const preventRefresh = ( event ) => {
		if ( importPercent < 100 ) {
			event.returnValue = __(
				'Are you sure you want to cancel the site import process?',
				'ai-builder'
			);
			return event;
		}
	};

	useEffect( () => {
		window.addEventListener( 'beforeunload', preventRefresh ); // eslint-disable-line
		return () => {
			window.removeEventListener( 'beforeunload', preventRefresh ); // eslint-disable-line
		};
	}, [ importPercent ] ); // Add importPercent as a dependency.

	// Add a useEffect to remove the event listener when importPercent is 100%.
	useEffect( () => {
		if ( importPercent === 100 ) {
			window.removeEventListener( 'beforeunload', preventRefresh );
		}
	}, [ importPercent ] );

	/**
	 * When try again button is clicked:
	 * There is a possibility that few/all the required plugins list is already installed.
	 * We cre-check the status of the required plugins here.
	 */
	useEffect( () => {
		if ( tryAgainCount > 0 ) {
			dispatch( {
				importPercent: 0,
				importStatus: __( 'Retrying Import.', 'ai-builder' ),
			} );
			handleImport();
		}
	}, [ tryAgainCount ] );

	const setStartFlag = async () => {
		const content = new FormData();
		content.append( 'action', 'astra-sites-set_start_flag' );
		content.append( '_ajax_nonce', aiBuilderVars._ajax_nonce );
		content.append( 'uuid', websiteInfo.uuid );
		content.append( 'template_type', 'ai' );

		await fetch( ajaxurl, {
			method: 'post',
			body: content,
		} );
	};

	const handleImport = async () => {
		if ( ! importError ) {
			localStorage.setItem( 'st-import-start', +new Date() );

			dispatch( {
				importStart: true,
				importPercent: 0,
				importStatus: __(
					'Preparing your site for import…',
					'ai-builder'
				),
			} );

			percentage.current += 2;

			dispatch( {
				importStart: true,
				importPercent: percentage.current,
				importStatus: __(
					'Preparing your site for import…',
					'ai-builder'
				),
			} );

			await setStartFlag();
			setIsReadyForImport( true );
		}
	};

	const handleImportStart = async () => {
		// The export data is already fetched (and stored server-side) once the
		// build reports 'Done', so it is not re-fetched here. Re-checking the
		// required plugins is still needed — on a try again some of them may
		// already be installed.
		await checkRequiredPlugins( dispatch );
		checkFileSystemPermissions( dispatch );

		percentage.current += 3;

		dispatch( {
			importPercent: percentage.current,
			importStatus: __( 'Starting Import.', 'ai-builder' ),
		} );

		if ( themeActivateFlag && false === themeStatus ) {
			installAstra( percentage.current, dispatch );
		} else {
			dispatch( {
				themeStatus: true,
			} );
		}
	};

	// Base reset applied on every retry — clears errors and import-phase flags.
	const buildRetryResetState = () => ( {
		// Reset errors.
		importErrorMessages: {},
		importErrorResponse: [],
		importError: false,
		isCreationFailure: false,
		creditAutoRestore: true,
		// Try again count.
		tryAgainCount: tryAgainCount + 1,
		// Reset import flags.
		xmlImportDone: false,
		resetData: [],
		importStart: false,
		importEnd: false,
		importPercent: 0,
		requiredPluginsDone: false,
		themeStatus: false,
		notInstalledList: [],
		notActivatedList: [],
	} );

	/**
	 * Rebuild the create-site request body from the current wizard selections in
	 * the store. The failed site is soft-deleted server-side, so a creation-stage
	 * retry has to re-dispatch site creation rather than re-poll the old uuid.
	 */
	const buildCreateSitePayload = () => {
		const selectedTemplateData = templateList?.find(
			( item ) => item?.uuid === selectedTemplate
		);

		const enabledFeatures = ( siteFeatures || [] )
			.filter( ( feature ) => feature.enabled )
			.map( ( feature ) => feature.id );

		if ( selectedTemplateData?.features?.ecommerce === 'yes' ) {
			enabledFeatures.push( 'ecommerce' );
		}
		if ( selectedTemplateData?.features?.donations === 'yes' ) {
			enabledFeatures.push( 'donations' );
		}

		return {
			template: selectedTemplate,
			business_email: businessContact?.email,
			business_description: businessDetails,
			business_name: businessName,
			business_phone: businessContact?.phone,
			business_address: businessContact?.address,
			business_category: businessType,
			image_keyword: keywords,
			social_profiles: businessContact?.socialMedia,
			language: siteLanguage,
			images: selectedImages,
			site_features: enabledFeatures,
			site_features_data: enabledFeatures.includes( 'ecommerce' )
				? siteFeaturesData
				: {},
		};
	};

	// Creation-stage retry: create a fresh site, then reset + resume polling.
	const recreateSite = async ( resetState ) => {
		try {
			const response = await apiFetch( {
				path: 'zipwp/v1/site',
				method: 'POST',
				data: buildCreateSitePayload(),
			} );

			if ( ! response?.success ) {
				report(
					response?.data?.data?.message ||
						__( 'Failed to create website', 'ai-builder' )
				);
				return;
			}

			const newSite = response?.data?.data?.site;
			setWebsiteInfoAIStep( newSite );

			currentStep = 0;
			percentage.current = 0;
			lastProgressAtRef.current = Date.now();

			dispatch( {
				...resetState,
				importStatus: __(
					'We are building your website…',
					'ai-builder'
				),
				createSiteStatus: false,
			} );

			fetchImportStatus();
		} catch ( error ) {
			report( error );
		}
	};

	const tryAainCallback = () => {
		// Reset the stall guard so a fresh attempt is not immediately flagged.
		lastProgressAtRef.current = Date.now();

		const resetState = buildRetryResetState();

		// A creation-stage failure has no site left to import — build a new one.
		if ( isCreationFailure ) {
			recreateSite( resetState );
			return;
		}

		dispatch( resetState );
	};

	const updateProgressBar = ( step, totalSteps ) => {
		if ( step >= totalSteps ) {
			percentage.current = 5;
			dispatch( {
				importPercent: percentage.current,
			} );
			return;
		}

		percentage.current = Math.floor( ( step / totalSteps ) * 5 );
		dispatch( {
			importPercent: percentage.current,
		} );
	};

	const getDemoWithRetry = async () => {
		try {
			return getAiDemo( stepsData, dispatch, websiteInfo );
		} catch ( error ) {
			report( error );
		}
	};

	/**
	 * Ask the backend to return the AI credit consumed by a failed build.
	 *
	 * The backend auto-restores on failure, so the common response is
	 * `already_restored`; we treat that and `restored_now` identically. The call
	 * is eligibility-gated server-side, so it is a no-op when there was no real
	 * credit-consuming failure. Returns a user-facing message, or '' if not
	 * restored.
	 */
	/**
	 * Final failure during site creation: show the error screen and flag it as a
	 * creation-stage failure so the UI offers credit-restore reassurance and a
	 * re-create retry (the backend soft-deletes the failed site + auto-restores
	 * the credit).
	 *
	 * @param {string}  msg         Failure message to display.
	 * @param {boolean} autoRestore Whether the backend confirmed the failure (so
	 *                              it auto-restores the credit). False for a
	 *                              client-side stall where the backend may still
	 *                              be running and nothing has been restored yet.
	 */
	const handleCreationFailure = ( msg, autoRestore = true ) => {
		report( msg || __( 'Failed to create website', 'ai-builder' ) );
		dispatch( { isCreationFailure: true, creditAutoRestore: autoRestore } );
	};

	const handleStatusResponse = async ( response ) => {
		const responseCode = response?.data?.data?.code;
		const responseCodeType = responseCode?.slice( 0, 1 );

		if ( ! ( responseCode in SITE_CREATION_STATUS_CODES ) ) {
			dispatch( {
				importStatus: __( 'Preparing the site…', 'ai-builder' ),
			} );
			await new Promise( ( resolve ) => setTimeout( resolve, 7000 ) );
			return await fetchImportStatus();
		}

		const msg = SITE_CREATION_STATUS_CODES[ responseCode ]?.trim();

		// Final failure (F-prefixed) — restore credit and show the error screen.
		if ( responseCodeType === 'F' ) {
			await handleCreationFailure( msg );
			return;
		}

		// Auto-retry (R-prefixed) and the ecommerce store tail (S-prefixed): both
		// keep polling and show a non-error message without touching the progress
		// bar. Store codes are emitted only for ecommerce builds, between A010 and
		// A011. The stall guard is refreshed only when the code changes, not on
		// every poll — the status endpoint re-emits the current code each time, so
		// resetting unconditionally would let a genuinely hung phase poll forever.
		if ( responseCodeType === 'R' || responseCodeType === 'S' ) {
			if ( responseCode !== lastStatusCodeRef.current ) {
				lastStatusCodeRef.current = responseCode;
				lastProgressAtRef.current = Date.now();
			}
			dispatch( {
				importStatus: msg,
			} );
			await new Promise( ( resolve ) => setTimeout( resolve, 7000 ) );
			return await fetchImportStatus();
		}

		// Progress step (A-prefixed).
		const step = +responseCode?.slice( 1 );

		// Avoid progress bar going back
		if ( step > currentStep ) {
			currentStep = step;
			lastProgressAtRef.current = Date.now();
			updateProgressBar( currentStep, TOTAL_STEPS );
		}

		// Make sure msg is not empty
		if ( msg && msg !== 'Done' ) {
			dispatch( {
				importStatus: msg,
			} );

			// Refresh status after 7 seconds.
			await new Promise( ( resolve ) => setTimeout( resolve, 7000 ) );
			return await fetchImportStatus();
		}

		if ( msg === 'Done' ) {
			dispatch( {
				importStatus: __( 'Please wait a moment…', 'ai-builder' ),
			} );

			const reqResponse = await getDemoWithRetry();

			if (
				! reqResponse.success ||
				( reqResponse.success &&
					Object.keys?.( reqResponse )?.length === 0 )
			) {
				report(
					__( 'Failed to create website', 'ai-builder' ),
					'',
					reqResponse?.data
				);
				return;
			}

			await checkRequiredPlugins( dispatch );
			checkFileSystemPermissions( dispatch );

			dispatch( {
				importStatus: __(
					'The website is created successfully!',
					'ai-builder'
				),
				createSiteStatus: true,
			} );

			/**
			 * Start the pre import process.
			 * 		1. Install Astra Theme
			 * 		2. Install Required Plugins.
			 */
			handleImport();
		}
	};

	const fetchImportStatus = async () => {
		if ( isFetchingStatus ) {
			return;
		}

		// Stall guard: no forward progress within the window means the backend
		// event never arrived (or the site was cleaned up). Fail gracefully so the
		// screen never polls forever.
		if ( Date.now() - lastProgressAtRef.current > STALL_TIMEOUT_MS ) {
			// Client-side stall: the backend may still be running, so it has not
			// necessarily failed the site or restored the credit yet.
			await handleCreationFailure(
				__(
					"This is taking longer than expected and we couldn't finish creating your site. Please try again.",
					'ai-builder'
				),
				false
			);
			return;
		}

		setIsFetchingStatus( true );

		try {
			const randomToken = ( Math.random() * 200 )?.toString(); // to avoid response caching
			const response = await apiFetch( {
				path: `zipwp/v1/import-status?uuid=${ websiteInfo.uuid }&token=${ randomToken }`,
				method: 'GET',
				headers: {
					'X-WP-Nonce': aiBuilderVars.rest_api_nonce,
					_ajax_nonce: aiBuilderVars._ajax_nonce,
				},
			} );

			// explicit check
			if ( response?.success === true ) {
				await handleStatusResponse( response );
			} else if ( response?.success === false ) {
				await handleCreationFailure(
					__( 'Failed to create website', 'ai-builder' )
				);
			}
		} catch ( error ) {
			report( error );
		} finally {
			setIsFetchingStatus( false );
		}
	};

	useEffect( () => {
		fetchImportStatus();
	}, [] );

	useEffect( () => {
		if ( isReadyForImport ) {
			handleImportStart();
			setIsReadyForImport( false );
		}
	}, [ isReadyForImport ] );

	/**
	 * Start the process only when:
	 * 		1. Required plugins are installed and activated.
	 * 		2. Astra Theme is installed
	 */
	useEffect( () => {
		if ( requiredPluginsDone && themeStatus ) {
			importPart1();
		}
	}, [ requiredPluginsDone, themeStatus ] );

	useEffect( () => {
		if ( themeStatus ) {
			installRequiredPlugins();
		}
	}, [ themeStatus, tryAgainCount ] );

	/**
	 * Start Part 2 of the import once the XML is imported sucessfully.
	 */
	useEffect( () => {
		if ( xmlImportDone ) {
			importPart2();
		}
	}, [ xmlImportDone ] );

	// This checks if all the required plugins are installed and activated.
	useEffect( () => {
		if (
			! requiredPlugins ||
			( requiredPlugins && ! Object.values( requiredPlugins ).length )
		) {
			return;
		}

		if ( notActivatedList.length <= 0 && notInstalledList.length <= 0 ) {
			dispatch( {
				requiredPluginsDone: true,
			} );
		}
	}, [ notActivatedList, notInstalledList, requiredPlugins, tryAgainCount ] );

	// Whenever a plugin is installed, this code sends an activation request.
	useEffect( () => {
		if (
			! requiredPlugins ||
			( requiredPlugins && ! Object.values( requiredPlugins ).length )
		) {
			return;
		}
		// Installed all required plugins.
		if ( notActivatedList.length > 0 ) {
			activatePlugin( notActivatedList[ 0 ] );
		}
	}, [ notActivatedList, requiredPlugins ] );

	// Confirmation before leaving the page.
	useEffect( () => {
		const handleBeforeUnload = () => importPercent < 100;
		window.onbeforeunload = handleBeforeUnload;

		return () => {
			window.onbeforeunload = null;
		};
	}, [ importPercent ] );

	const handleClose = () => {
		window.location.href = `${ aiBuilderVars.adminUrl }themes.php?page=starter-templates`;
	};

	// Fall back to the classic progress loader when the promotional feature
	// carousel is disabled (via the `ai_builder_should_show_import_carousel` filter).
	if ( ! aiBuilderVars.showImportCarousel ) {
		return (
			<div className="flex flex-1 flex-col items-center justify-center w-full gap-y-4 pb-10">
				<div className="flex flex-col sm:flex-row items-center justify-center gap-6">
					{ ! importError && (
						<GradientProgressRing percent={ importPercent } />
					) }
					{ importError && (
						<ErrorModel
							error={ importErrorMessages }
							websiteInfo={ websiteInfo }
							tryAgainCallback={ tryAainCallback }
							showCreditRestore={ isCreationFailure }
							creditAutoRestore={ creditAutoRestore }
							hideTryAgain={ tryAgainCount >= 1 }
						/>
					) }
					<div className="flex flex-col">
						{ ! importError && (
							<h4 className="text-xl sm:text-left text-center">
								{ __(
									'We are building your website…',
									'ai-builder'
								) }
							</h4>
						) }
						{ ! importError && (
							<div className="zw-sm-normal text-app-text w-[350px]">
								<ImportLoaderAi onClickNext={ nextStep } />
							</div>
						) }
					</div>
				</div>
				{ ! importError && (
					<div className="relative flex items-center justify-center px-0 sm:px-10 py-6 h-120 w-120 bg-loading-website-grid-texture">
						<img
							className="w-[30rem] h-[20.875rem]"
							src={ aiBuilderVars.migrateSvg }
							alt={ __( 'Migrating', 'ai-builder' ) }
						/>
					</div>
				) }
			</div>
		);
	}

	return (
		<>
			<div className="flex flex-1 flex-col items-center justify-start gap-6 w-full pb-8">
				{ importError ? (
					<ErrorModel
						error={ importErrorMessages }
						websiteInfo={ websiteInfo }
						tryAgainCallback={ tryAainCallback }
						showCreditRestore={ isCreationFailure }
						creditAutoRestore={ creditAutoRestore }
						hideTryAgain={ tryAgainCount >= 1 }
					/>
				) : (
					<>
						{ /* Intro */ }
						<div className="flex flex-col items-center gap-2.5 text-center max-w-[560px]">
							<span className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.07em] uppercase text-gradient-color-3">
								<span className="w-2 h-2 rounded-full bg-gradient-color-3 animate-blip" />
								{ __( 'Building your website', 'ai-builder' ) }
							</span>
							<h1 className="m-0 text-[28px] font-extrabold tracking-tight text-[#16182a]">
								{ __(
									"Sit back. We're building your website",
									'ai-builder'
								) }
							</h1>
							<p className="m-0 text-base leading-relaxed text-[#5a6679]">
								{ __(
									"This usually takes under a minute. While you wait, here's what you can do with ZipWP.",
									'ai-builder'
								) }
							</p>
						</div>

						{ /* Feature carousel */ }
						<FeatureCarousel />

						{ /* Progress ring + status. The fixed-width box anchors
					the ring + text pair as one centered unit; the absolute
					inner overlay lets long text use more width without
					shifting the ring. */ }
						<div className="flex items-center justify-center gap-4">
							<GradientProgressRing percent={ importPercent } />
							<div className="w-[200px] shrink-0 self-stretch relative">
								<div className="absolute inset-y-0 left-0 w-[240px] sm:w-[420px] flex items-center zw-sm-normal text-[#475569]">
									<ImportLoaderAi onClickNext={ nextStep } />
								</div>
							</div>
						</div>
					</>
				) }
			</div>

			{ /* Close button — always visible */ }
			<div className="fixed top-5 right-5 z-50">
				{ importError ? (
					<button
						onClick={ handleClose }
						className="w-9 h-9 border-0 rounded-full bg-[rgba(15,23,42,0.05)] text-[#475569] text-[15px] cursor-pointer grid place-items-center transition-colors duration-150 hover:bg-[rgba(15,23,42,0.10)]"
						aria-label={ __( 'Close', 'ai-builder' ) }
					>
						&#10005;
					</button>
				) : (
					<ExitConfirmationPopover
						onExit={ handleClose }
						placement="bottom-end"
						exitButtonClassName="!w-9 !h-9 !rounded-full bg-[rgba(15,23,42,0.05)] text-[#475569] grid place-items-center transition-colors duration-150 hover:bg-[rgba(15,23,42,0.10)]"
					/>
				) }
			</div>

			{ /* Ask Me support CTA */ }
			<a
				href={ supportLink }
				target="_blank"
				rel="noopener noreferrer"
				className="fixed right-7 bottom-[26px] z-[6] inline-flex items-center gap-2.5 border-0 bg-white rounded-full py-2.5 pl-2.5 pr-4 shadow-[0_10px_26px_rgba(15,23,42,0.16)] no-underline text-sm font-semibold text-[#1e293b] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_14px_30px_rgba(15,23,42,0.2)]"
			>
				<span className="w-[30px] h-[30px] rounded-full bg-gradient-1 grid place-items-center">
					<span className="w-[11px] h-[11px] rounded-[2px_8px_8px_8px] bg-white opacity-95" />
				</span>
				{ __( 'Ask Me', 'ai-builder' ) }
			</a>
		</>
	);
};

export default ImportAiSite;
