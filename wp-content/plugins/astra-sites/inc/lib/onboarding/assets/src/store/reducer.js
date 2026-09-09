import { STEPS } from '../steps/util';
import { getURLParmsValue } from '../utils/url-params';
import { __ } from '@wordpress/i18n';

let currentIndexKey = 0;
let builderKey = 'gutenberg';

if ( astraSitesVars?.default_page_builder ) {
	currentIndexKey = 0;
	builderKey =
		astraSitesVars?.default_page_builder === 'brizy'
			? 'gutenberg'
			: astraSitesVars?.default_page_builder;

	// If AI builder is disabled but set as default, fallback to gutenberg
	if ( builderKey === 'ai-builder' && ! astraSitesVars?.showAiBuilder ) {
		builderKey = 'gutenberg';
	}
}

export const siteLogoDefault = {
	id: '',
	thumbnail: '',
	url: '',
	width: 120,
};

export const initialState = {
	siteFeatures: [
		// {
		// 	title: __( 'Blog', 'astra-sites' ),
		// 	id: 'blog',
		// 	description: __(
		// 		'Display a well-designed blog on your website',
		// 		'astra-sites'
		// 	),
		// 	enabled: false,
		// 	compulsory: false,
		// 	icon: 'blog',
		// },
		{
			title: __( 'Page Builder', 'astra-sites' ),
			id: 'page-builder',
			description: __(
				'Design pages with visual website builder',
				'astra-sites'
			),
			enabled: true,
			compulsory: true,
			icon: 'page-builder',
		},
		{
			title: __( 'Contact Form', 'astra-sites' ),
			id: 'contact-form',
			description: __(
				'Allow your visitors to get in touch with you',
				'astra-sites'
			),
			enabled: true,
			compulsory: true,
			icon: 'contact-form',
		},
		{
			title: __( 'eCommerce', 'astra-sites' ),
			id: 'ecommerce',
			description: __( 'Sell your products online', 'astra-sites' ),
			enabled: false,
			compulsory: false,
			icon: 'ecommerce',
			plugins: [ 'woocommerce', 'surecart' ],
		},
		{
			title: __( 'Donations', 'astra-sites' ),
			id: 'donations',
			description: __(
				'Collect donations on your website',
				'astra-sites'
			),
			enabled: false,
			compulsory: false,
			icon: 'heart',
			plugins: [ 'suredonation' ],
		},
		{
			title: __( 'SEO & Search Visibility', 'astra-sites' ),
			id: 'seo',
			description: __(
				'Optimize your website for search engines',
				'astra-sites'
			),
			enabled: true,
			compulsory: false,
			icon: 'arrow-trending-up',
			plugins: [ 'surerank' ],
		},
		// Will be added back.
		// {
		// 	title: __( 'Automation & Integrations', 'astra-sites' ),
		// 	id: 'automation-integrations',
		// 	description: __( 'Automate your website & tasks', 'astra-sites' ),
		// 	enabled: false,
		// 	compulsory: false,
		// 	icon: 'squares-plus',
		// 	plugins: [ 'suretriggers' ],
		// },
		// Removing
		// {
		// 	title: __( 'Appointment & Bookings', 'astra-sites' ),
		// 	id: 'appointment-bookings',
		// 	description: __(
		// 		'Easily manage bookings for your services',
		// 		'astra-sites'
		// 	),
		// 	enabled: false,
		// 	compulsory: false,
		// 	icon: 'calendar',
		// 	plugins: [ 'latepoint' ],
		// },
		{
			title: __( 'Website Emails & SMTP', 'astra-sites' ),
			id: 'smtp',
			description: __(
				'Get emails from your website (forms, etc)',
				'astra-sites'
			),
			enabled: false,
			compulsory: false,
			icon: 'envelope',
			plugins: [ 'suremail' ],
		},
		{
			title: __( 'CRM & Contacts', 'astra-sites' ),
			id: 'crm-contacts',
			description: __(
				'Keep all your customer relationships in one place',
				'astra-sites'
			),
			enabled: false,
			compulsory: false,
			icon: 'users',
			plugins: [ 'surecontact' ],
		},
		{
			title: __( 'Cookie Consent', 'astra-sites' ),
			id: 'surecookie',
			description: __(
				'Add cookie consent and privacy compliance tools',
				'astra-sites'
			),
			enabled: true,
			compulsory: false,
			icon: 'surecookie',
			plugins: [ 'surecookie' ],
		},
		{
			title: __( 'Conversion Testing', 'astra-sites' ),
			id: 'sigmize',
			description: __(
				'Run A/B tests and see what converts best',
				'astra-sites'
			),
			enabled: false,
			compulsory: false,
			icon: 'sigmize',
			plugins: [ 'sigmize' ],
		},
		{
			title: __( 'Free Live Chat', 'astra-sites' ),
			id: 'live-chat',
			description: __(
				'Connect with your website visitors for free',
				'astra-sites'
			),
			enabled: false,
			compulsory: false,
			icon: 'live-chat',
			plugins: [ 'wp-live-chat-support' ],
		},
	],
	formDetails: {
		first_name: '',
		email: astraSitesVars?.userDetails?.email || '',
		opt_in: true,
	},
	selectedEcommercePlugin: '',
	isEcommerce: false,
	allSitesData: astraSitesVars?.all_sites || {},
	allCategories: astraSitesVars?.allCategories || [],
	allCategoriesAndTags: astraSitesVars?.allCategoriesAndTags || [],
	aiActivePallette: null,
	aiActiveTypography: null,
	aiSiteLogo: siteLogoDefault,
	currentIndex: 'ai-builder' === builderKey ? 0 : currentIndexKey,
	currentCustomizeIndex: 0,
	siteLogo: siteLogoDefault,
	activePaletteSlug: 'default',
	activePalette: {},
	typography: {},
	typographyIndex: 0,
	stepsLength: Object.keys( STEPS ).length,

	builder: builderKey,
	siteType: '',
	siteOrder: 'popular',
	siteBusinessType: '',
	selectedMegaMenu: '',
	siteSearchTerm: getURLParmsValue( window.location.search, 's' ) || '',
	userSubscribed: false,
	showSidebar: window && window?.innerWidth < 1024 ? false : true,
	tryAgainCount: 0,
	pluginInstallationAttempts: 0,
	confettiDone: false,

	// Template Information.
	templateId: 0,
	templateResponse: null,
	requiredPlugins: null,
	fileSystemPermissions: null,
	selectedTemplateID: '',
	selectedTemplateName: '',
	selectedTemplateType: '',

	// Import statuses.
	reset: 'yes' === starterTemplates.firstImportStatus ? true : false,
	allowResetSite: true,
	themeStatus: false,
	importStatusLog: '',
	importStatus: '',
	xmlImportDone: false,
	requiredPluginsDone: false,
	notInstalledList: [],
	notActivatedList: [],
	skippedPlugins: [],
	awaitingPluginCheck: false,
	// Per-plugin install/activate status map, keyed by slug.
	// Shape: { [slug]: { state, type, error, failedAt, attempts, name, slug, init } }
	// state: 'pending' | 'installing' | 'activating' | 'success' | 'failed' | 'skipped'
	// type:  'required' | 'optional'
	pluginStatuses: {},
	resetData: [],
	importStart: false,
	importEnd: false,
	importPercent: 0,
	importError: false,
	importErrorMessages: {
		primaryText: '',
		secondaryText: '',
		errorCode: '',
		errorText: '',
		solutionText: '',
		tryAgain: false,
	},
	importErrorResponse: [],
	importTimeTaken: {},

	customizerImportFlag:
		astraSitesVars?.default_page_builder === 'fse' ? false : true,
	themeActivateFlag:
		astraSitesVars?.default_page_builder === 'fse' ? false : true,
	widgetImportFlag: true,
	contentImportFlag: true,
	analyticsFlag: starterTemplates.analytics !== 'yes' ? true : false,
	shownRequirementOnce: false,

	// Filter Favorites.
	onMyFavorite: false,

	// All Sites and Favorites
	favoriteSiteIDs: Object.values( astraSitesVars?.favorite_data ) || [],

	// License.
	licenseStatus: astraSitesVars?.license_status,
	validateLicenseStatus: false,

	// Staging connected.
	stagingConnected:
		astraSitesVars?.staging_connected !== 'yes'
			? ''
			: '&draft=' + astraSitesVars?.staging_connected,

	// Search.
	searchTerms: [],
	searchTermsWithCount: [],
	enabledFeatureIds: [],
	dismissAINotice: astraSitesVars?.dismiss_ai_notice,

	// Sync Library.
	bgSyncInProgress: !! astraSitesVars?.bgSyncInProgress,
	sitesSyncing: false,
	syncPageCount: 0,
	syncPageInProgress: 0,

	// Limit exceed modal for AI-Builder.
	limitExceedModal: {
		open: false,
	},

	// Page builder API loading state and cache
	pageBuilderCache: {
		timestamp: null,
	},

	// Spectra Blocks Version
	spectraBlocksVersion: astraSitesVars?.spectraBlocks?.version || 'v2',
};

// Once we've handed off to the broader import pipeline (theme install, content
// import, etc.), late-arriving plugin XHRs (e.g. a slow optional/deferred
// activate) must not overwrite the global importStatus/importPercent shown by
// ImportLoader — otherwise the user sees "Activating X plugin." re-appear at
// 90%. Plugin-row state inside pluginStatuses still updates normally.
const pluginProgressFields = ( state, rest ) => {
	if ( state.requiredPluginsDone ) {
		return {
			importStatus: state.importStatus,
			importPercent: state.importPercent,
		};
	}
	return {
		importStatus: rest.importStatus || state.importStatus,
		importPercent: rest.importPercent ?? state.importPercent,
	};
};

const reducer = ( state = initialState, { type, ...rest } ) => {
	switch ( type ) {
		case 'set':
			return { ...state, ...rest };

		// Plugin install started: mark status as 'installing'.
		case 'plugin_install_started':
			return {
				...state,
				pluginStatuses: {
					...state.pluginStatuses,
					[ rest.plugin.slug ]: {
						...state.pluginStatuses[ rest.plugin.slug ],
						state: 'installing',
					},
				},
			};

		// Plugin activate started: mark status as 'activating' and update progress.
		case 'plugin_activate_started':
			return {
				...state,
				...pluginProgressFields( state, rest ),
				pluginStatuses: {
					...state.pluginStatuses,
					[ rest.plugin.slug ]: {
						...state.pluginStatuses[ rest.plugin.slug ],
						state: 'activating',
					},
				},
			};

		// Plugin installed: move from notInstalledList to notActivatedList
		// Uses current state to avoid closure issues
		case 'plugin_installed': {
			const remainingInstalls = state.notInstalledList.filter(
				( p ) => p.slug !== rest.plugin.slug
			);
			const next = remainingInstalls[ 0 ];
			const updatedStatuses = {
				...state.pluginStatuses,
				[ rest.plugin.slug ]: {
					...state.pluginStatuses[ rest.plugin.slug ],
					state: 'activating',
				},
			};
			if ( next ) {
				updatedStatuses[ next.slug ] = {
					...state.pluginStatuses[ next.slug ],
					state: 'installing',
				};
			}
			return {
				...state,
				notActivatedList: [ ...state.notActivatedList, rest.plugin ],
				notInstalledList: remainingInstalls,
				pluginStatuses: updatedStatuses,
				...pluginProgressFields( state, rest ),
			};
		}

		// Plugin activated: remove from notActivatedList
		// Uses current state to avoid closure issues
		case 'plugin_activated':
			return {
				...state,
				notActivatedList: state.notActivatedList.filter(
					( p ) => p.slug !== rest.plugin.slug
				),
				pluginStatuses: {
					...state.pluginStatuses,
					[ rest.plugin.slug ]: {
						...state.pluginStatuses[ rest.plugin.slug ],
						state: 'success',
					},
				},
				...pluginProgressFields( state, rest ),
			};

		// Plugin deferred: remove from notActivatedList; retried after its dependency activates.
		// Reset state to 'pending' so the row's status pill no longer shows
		// 'activating' — otherwise a deprioritized plugin looks stuck spinning
		// until its dependency's activation completes and we re-queue it.
		case 'plugin_deferred':
			return {
				...state,
				notActivatedList: state.notActivatedList.filter(
					( p ) => p.slug !== rest.plugin.slug
				),
				pluginStatuses: {
					...state.pluginStatuses,
					[ rest.plugin.slug ]: {
						...state.pluginStatuses[ rest.plugin.slug ],
						state: 'pending',
					},
				},
				...pluginProgressFields( state, rest ),
			};

		// Deferred plugins re-queued for activation: merge into current notActivatedList.
		// Uses state.notActivatedList (not closure) to avoid overwriting activations
		// that completed between when retryDeferredPlugins() read the list and dispatch.
		case 'plugin_retry_deferred':
			return {
				...state,
				notActivatedList: [
					...state.notActivatedList,
					...rest.plugins,
				],
			};

		// Plugin install failed: remove from notInstalledList, mark failed in status map.
		case 'plugin_install_failed': {
			const remainingInstalls = state.notInstalledList.filter(
				( p ) => p.slug !== rest.plugin.slug
			);
			const next = remainingInstalls[ 0 ];
			const updatedStatuses = {
				...state.pluginStatuses,
				[ rest.plugin.slug ]: {
					...state.pluginStatuses[ rest.plugin.slug ],
					state: 'failed',
					error: rest.error || null,
					failedAt: 'install',
					attempts:
						( state.pluginStatuses[ rest.plugin.slug ]?.attempts ||
							0 ) + 1,
				},
			};
			if ( next ) {
				updatedStatuses[ next.slug ] = {
					...state.pluginStatuses[ next.slug ],
					state: 'installing',
				};
			}
			return {
				...state,
				notInstalledList: remainingInstalls,
				pluginStatuses: updatedStatuses,
				pluginInstallationAttempts:
					state.pluginInstallationAttempts + 1,
			};
		}

		// Plugin activation failed: remove from notActivatedList, mark failed in status map.
		case 'plugin_activate_failed':
			return {
				...state,
				notActivatedList: state.notActivatedList.filter(
					( p ) => p.slug !== rest.plugin.slug
				),
				pluginStatuses: {
					...state.pluginStatuses,
					[ rest.plugin.slug ]: {
						...state.pluginStatuses[ rest.plugin.slug ],
						state: 'failed',
						error: rest.error || null,
						failedAt: 'activate',
						attempts:
							( state.pluginStatuses[ rest.plugin.slug ]
								?.attempts || 0 ) + 1,
					},
				},
				pluginInstallationAttempts:
					state.pluginInstallationAttempts + 1,
			};

		// Re-queue a single failed plugin for retry.
		// Dedupe against the target list so a fast double-click on Retry
		// (or any caller that re-fires the action) cannot enqueue the same
		// slug twice and trigger duplicate installs/activations.
		case 'plugin_retry': {
			const retryPlugin = rest.plugin;
			const currentStatus =
				state.pluginStatuses[ retryPlugin.slug ] || {};
			const updatedStatuses = {
				...state.pluginStatuses,
				[ retryPlugin.slug ]: {
					...currentStatus,
					state: 'pending',
					error: null,
					failedAt: null,
				},
			};
			if ( currentStatus.failedAt === 'activate' ) {
				const alreadyQueued = state.notActivatedList.some(
					( p ) => p.slug === retryPlugin.slug
				);
				return {
					...state,
					pluginStatuses: updatedStatuses,
					notActivatedList: alreadyQueued
						? state.notActivatedList
						: [ ...state.notActivatedList, retryPlugin ],
				};
			}
			const alreadyQueued = state.notInstalledList.some(
				( p ) => p.slug === retryPlugin.slug
			);
			return {
				...state,
				pluginStatuses: updatedStatuses,
				notInstalledList: alreadyQueued
					? state.notInstalledList
					: [ ...state.notInstalledList, retryPlugin ],
			};
		}

		// Move all failed optional plugins to 'skipped' and add their inits to skippedPlugins.
		case 'skip_optional_failures': {
			const failedOptional = Object.entries(
				state.pluginStatuses
			).filter(
				( [ , s ] ) => s.type === 'optional' && s.state === 'failed'
			);
			const newSkipped = failedOptional.map( ( [ , s ] ) => ( {
				slug: s.slug,
				init: s.init,
				name: s.name,
			} ) );
			const updatedStatuses = { ...state.pluginStatuses };
			failedOptional.forEach( ( [ slug ] ) => {
				updatedStatuses[ slug ] = {
					...updatedStatuses[ slug ],
					state: 'skipped',
				};
			} );
			return {
				...state,
				pluginStatuses: updatedStatuses,
				skippedPlugins: [ ...state.skippedPlugins, ...newSkipped ],
			};
		}

		default:
			return state;
	}
};

export default reducer;
