import { __, sprintf } from '@wordpress/i18n';
import { useState, createInterpolateElement } from '@wordpress/element';
import { decodeEntities } from '@wordpress/html-entities';
import { useStateValue } from '../../store/store';
import LoadingSpinner from '../loading-spinner/loading-spinner';
import Tooltip from '../tooltip/tooltip';
const { imageDir, adminUrl } = starterTemplates;

export const MAX_RETRIES = 3;

const pluginInstallSearchUrl = ( slug ) =>
	`${ adminUrl }plugin-install.php?tab=search&type=term&s=${ encodeURIComponent(
		slug
	) }`;

// Module-scoped so it isn't redeclared on every PluginInstallList render —
// otherwise React treats it as a new component type on each render and would
// remount the SVG during plugin install (which dispatches frequently).
const RefreshIcon = ( { className = 'w-4 h-4' } ) => (
	<svg
		className={ className }
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 24 24"
		stroke="currentColor"
		strokeWidth="2"
		aria-hidden="true"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
		/>
	</svg>
);

const PLUGIN_ICON_MAP = {
	'astra-addon': 'astra.svg',
	cartflows: 'cartflows.svg',
	elementor: 'elementor.svg',
	'header-footer-elementor': 'uae.svg',
	latepoint: 'latepoint.svg',
	'presto-player': 'presto-player.svg',
	'spectra-blocks': 'spectra.svg',
	'spectra-pro': 'spectra.svg',
	surecart: 'surecart.svg',
	suredonation: 'suredonation.png',
	sureforms: 'sureforms.svg',
	suremails: 'suremails.svg',
	surerank: 'surerank.svg',
	suretriggers: 'ottokit.svg',
	surecookie: 'surecookie.svg',
	sigmize: 'sigmize.svg',
	'ultimate-addons-for-gutenberg': 'spectra.svg',
	'ultimate-elementor': 'uae.svg',
	'variation-swatches-woo': 'variation-swatches-woo.svg',
	woocommerce: 'woocommerce.svg',
	'woocommerce-payments': 'woopayments.png',
	'woo-cart-abandonment-recovery': 'cartflows-ca.png',
	wpforms: 'wpforms.png',
	'wpforms-lite': 'wpforms.png',
	'wp-live-chat-support': '3cx.png',
	'power-coupons': 'power-coupons.svg',
};

const STATUS_PILL_BASE =
	'inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap border';

const STATUS_PILL = {
	installing: `${ STATUS_PILL_BASE } border-blue-200 bg-blue-50/60 text-blue-700`,
	activating: `${ STATUS_PILL_BASE } border-blue-200 bg-blue-50/60 text-blue-700`,
	success: `${ STATUS_PILL_BASE } border-emerald-200 bg-emerald-50/60 text-emerald-700`,
	failed: `${ STATUS_PILL_BASE } border-red-200 bg-red-50/60 text-red-700`,
	skipped: `${ STATUS_PILL_BASE } border-gray-200 bg-white text-gray-500`,
	pending: `${ STATUS_PILL_BASE } border-gray-200 bg-white text-gray-500`,
};

const STATUS_LABEL = {
	installing: __( 'Installing…', 'astra-sites' ),
	activating: __( 'Activating…', 'astra-sites' ),
	success: __( 'Active', 'astra-sites' ),
	failed: __( 'Failed', 'astra-sites' ),
	skipped: __( 'Skipped', 'astra-sites' ),
	pending: __( 'Pending', 'astra-sites' ),
};

const Spinner = ( { colorClassName = 'text-blue-700' } ) => (
	<LoadingSpinner
		widthClassName="w-3"
		heightClassName="h-3"
		colorClassName={ colorClassName }
	/>
);

// WP plugin install errors can return strings containing HTML and entities.
// We don't render the markup — just strip tags and decode entities so the
// message is readable plain text.
const cleanErrorMessage = ( raw ) => {
	if ( ! raw || typeof raw !== 'string' ) {
		return raw;
	}
	const stripped = raw.replace( /<\/?[^>]+>/g, '' );
	return decodeEntities( stripped ).replace( /\s+/g, ' ' ).trim();
};

const StatusPill = ( { state } ) => {
	const key = STATUS_PILL[ state ] ? state : 'pending';
	const showSpinner = key === 'installing' || key === 'activating';
	return (
		<span className={ STATUS_PILL[ key ] }>
			{ showSpinner && <Spinner /> }
			{ STATUS_LABEL[ key ] }
		</span>
	);
};

const PluginRow = ( {
	pluginStatus,
	onRetry,
	maxAttemptsReached,
	queueBusy,
} ) => {
	const { slug, name, state, error, type, installUrl } = pluginStatus;
	const [ imgLoaded, setImgLoaded ] = useState( false );
	const iconFile = PLUGIN_ICON_MAP[ slug ];

	return (
		<li className="border-b border-gray-100 last:border-b-0">
			<div className="flex items-center gap-3 mb-2">
				<div className="flex-shrink-0 w-10 h-10 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center">
					{ iconFile ? (
						<img
							src={ `${ imageDir }/grayscale/${ iconFile }` }
							alt=""
							className={ `max-w-6 max-h-6 transition-opacity duration-200 ${
								imgLoaded ? 'opacity-100' : 'opacity-0'
							}` }
							onLoad={ () => setImgLoaded( true ) }
						/>
					) : (
						<span className="text-gray-500 text-sm font-semibold">
							{ name.charAt( 0 ) }
						</span>
					) }
				</div>
				<div className="flex-1 min-w-0 !text-left">
					<span className="text-sm font-semibold text-gray-900 truncate leading-tight">
						{ name }
						{ type === 'required' && (
							<span
								className="text-red-500 ml-0.5"
								title={ __( 'Required plugin', 'astra-sites' ) }
								aria-label={ __(
									'Required plugin',
									'astra-sites'
								) }
							>
								*
							</span>
						) }
					</span>
				</div>
				<div className="flex-shrink-0 flex items-center gap-2.5">
					<StatusPill state={ state } />
					{ state === 'failed' &&
						! maxAttemptsReached &&
						! queueBusy && (
							<button
								type="button"
								onClick={ () => onRetry( pluginStatus ) }
								className="inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1 rounded-md border-0 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer transition-colors !w-auto !mt-0"
							>
								<RefreshIcon className="w-3 h-3" />
								{ __( 'Retry', 'astra-sites' ) }
							</button>
						) }
				</div>
			</div>
			{ state === 'failed' && ( error || maxAttemptsReached ) && (
				<div className="pl-[52px] pb-2 text-xs text-red-700 flex flex-col gap-1 !text-left">
					{ error && <span>{ cleanErrorMessage( error ) }</span> }
					{ maxAttemptsReached && (
						<span>
							{ createInterpolateElement(
								sprintf(
									/* translators: %1$s: plugin name */
									__(
										'Could not install %1$s automatically. <a>Click here to install it manually</a>, then come back to this tab.',
										'astra-sites'
									),
									name
								),
								{
									a: (
										// eslint-disable-next-line jsx-a11y/anchor-has-content
										<a
											href={
												installUrl ||
												pluginInstallSearchUrl( slug )
											}
											target="_blank"
											rel="noopener noreferrer"
											className="text-red-700 underline hover:text-red-800 font-medium"
										/>
									),
								}
							) }
						</span>
					) }
				</div>
			) }
		</li>
	);
};

const PluginInstallList = ( {
	onRetryPlugin,
	onProceedWithoutOptional,
	onRetryAll,
	onCheckAgain,
	onGoBack,
} ) => {
	const [
		{
			pluginStatuses,
			notInstalledList,
			notActivatedList,
			importPercent,
			importStatus,
			awaitingPluginCheck,
		},
	] = useStateValue();

	const allStatuses = Object.values( pluginStatuses );
	const requiredPlugins = allStatuses.filter(
		( s ) => s.type === 'required'
	);
	const optionalPlugins = allStatuses.filter(
		( s ) => s.type === 'optional'
	);

	// Mirror the global import percentage (also used by ImportLoader) so the
	// number doesn't visually regress when transitioning to the next step
	// (e.g. 100% → 70%). Plugin step is conceptually phase 1 of the broader
	// import; using the same value keeps the bar monotonic across screens.
	const percent = Math.min(
		100,
		Math.max( 0, Number( importPercent ) || 0 )
	);

	let percentClass = 'import-1';
	if ( percent > 25 && percent <= 50 ) {
		percentClass = 'import-2';
	} else if ( percent > 50 && percent <= 75 ) {
		percentClass = 'import-3';
	} else if ( percent > 75 ) {
		percentClass = 'import-4';
	}

	// Include awaitingPluginCheck so CTAs don't flash between a Refresh
	// dispatch clearing the lists and the server response repopulating them.
	const inProgress =
		notInstalledList.length > 0 ||
		notActivatedList.length > 0 ||
		awaitingPluginCheck;
	const hasFailedRequired = requiredPlugins.some(
		( s ) => s.state === 'failed'
	);
	const hasFailedOptional = optionalPlugins.some(
		( s ) => s.state === 'failed'
	);

	// A plugin is retryable only while it's still under the per-plugin retry cap.
	// Plugins that hit MAX_RETRIES surface a manual-install fallback instead and
	// should not contribute to the Retry Failed (n) count or be re-queued by it.
	const failedRetryableRequired = requiredPlugins.filter(
		( s ) => s.state === 'failed' && ( s.attempts || 0 ) < MAX_RETRIES
	);
	const failedRetryableOptional = optionalPlugins.filter(
		( s ) => s.state === 'failed' && ( s.attempts || 0 ) < MAX_RETRIES
	);

	const stepText = __(
		'1. Installing required theme, plugins, forms, etc',
		'astra-sites'
	);
	// Drive the status line from the global store's importStatus so the same
	// area that ImportLoader uses in later phases is reused here — single
	// source of truth across the import flow. Local overrides handle the
	// terminal failure copy (which the store doesn't dispatch for us).
	let statusLine = importStatus;
	if ( hasFailedRequired ) {
		statusLine = __(
			'Some required plugins could not be installed. Please retry below.',
			'astra-sites'
		);
	} else if ( ! inProgress && hasFailedOptional ) {
		statusLine = __(
			'Optional plugins failed. You can continue without them or retry.',
			'astra-sites'
		);
	}

	// !w-auto and !mt-0 override the legacy `.step-import-site button` styles
	// (width: 100%; margin-top: 25px) defined in the import-site SCSS, which
	// would otherwise stretch these CTAs full-width and stack them.
	const primaryBtn =
		'inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-5 py-2 rounded-md border-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium cursor-pointer transition-colors !w-auto !mt-0';
	const secondaryBtn =
		'inline-flex items-center justify-center gap-1.5 whitespace-nowrap px-5 py-2 rounded-md border border-blue-600 bg-white hover:bg-blue-50 text-blue-600 hover:text-blue-700 text-sm font-medium cursor-pointer transition-colors !w-auto !mt-0';

	return (
		<div className="ist-import-progress !text-left">
			<div className="ist-import-progress-info">
				<div className="ist-import-progress-info-text">
					<span className="ist-import-text-inner">{ stepText }</span>
				</div>
				<div className="ist-import-progress-info-precent">
					{ percent }%
				</div>
			</div>
			<div className="ist-import-progress-bar-wrap">
				<div className="ist-import-progress-bar-bg">
					<div
						className={ `ist-import-progress-bar ${ percentClass }` }
					/>
				</div>
				<div className="import-progress-gap">
					<span />
					<span />
					<span />
				</div>
			</div>
			<div className="ist-import-progress-info">
				<div className="ist-import-progress-info-text">
					<div className="import-status-string">
						<p>{ statusLine }</p>
					</div>
				</div>
			</div>

			<ul className="list-none m-0 mt-4 p-0">
				{ requiredPlugins.map( ( ps ) => (
					<PluginRow
						key={ ps.slug }
						pluginStatus={ ps }
						onRetry={ onRetryPlugin }
						maxAttemptsReached={ ps.attempts >= MAX_RETRIES }
						queueBusy={ inProgress }
					/>
				) ) }
				{ optionalPlugins.map( ( ps ) => (
					<PluginRow
						key={ ps.slug }
						pluginStatus={ ps }
						onRetry={ onRetryPlugin }
						maxAttemptsReached={ ps.attempts >= MAX_RETRIES }
						queueBusy={ inProgress }
					/>
				) ) }
			</ul>

			{ ! inProgress && hasFailedRequired && (
				<div className="flex flex-wrap items-center gap-3 mt-5">
					{ typeof onGoBack === 'function' && (
						<button
							type="button"
							onClick={ onGoBack }
							className={ `${ secondaryBtn } mr-auto` }
						>
							{ __( 'Back to Templates', 'astra-sites' ) }
						</button>
					) }
					<Tooltip
						content={ __(
							'Re-check plugin status. Use this after manually installing or activating a plugin in another tab.',
							'astra-sites'
						) }
					>
						<button
							type="button"
							onClick={ onCheckAgain }
							className={ secondaryBtn }
						>
							<RefreshIcon />
							{ __( 'Refresh', 'astra-sites' ) }
						</button>
					</Tooltip>
					{ failedRetryableRequired.length > 0 && (
						<button
							type="button"
							onClick={ onRetryAll }
							className={ primaryBtn }
						>
							{ sprintf(
								/* translators: %d: failed count */
								__( 'Retry Failed (%d)', 'astra-sites' ),
								failedRetryableRequired.length
							) }
						</button>
					) }
				</div>
			) }

			{ ! inProgress && ! hasFailedRequired && hasFailedOptional && (
				<div className="flex flex-wrap gap-3 mt-5 justify-end !text-right">
					<Tooltip
						content={ __(
							'Re-check plugin status. Use this after manually installing or activating a plugin in another tab.',
							'astra-sites'
						) }
					>
						<button
							type="button"
							onClick={ onCheckAgain }
							className={ secondaryBtn }
						>
							<RefreshIcon />
							{ __( 'Refresh', 'astra-sites' ) }
						</button>
					</Tooltip>
					{ failedRetryableOptional.length > 0 && (
						<button
							type="button"
							onClick={ onRetryAll }
							className={ secondaryBtn }
						>
							{ __( 'Retry optional', 'astra-sites' ) }
						</button>
					) }
					<Tooltip
						content={ __(
							'Mark failed optional plugins as skipped and continue with the import. Your site will work without them. You can install them later from Plugins → Add New.',
							'astra-sites'
						) }
					>
						<button
							type="button"
							onClick={ onProceedWithoutOptional }
							className={ primaryBtn }
						>
							{ __( 'Continue', 'astra-sites' ) }
						</button>
					</Tooltip>
				</div>
			) }
		</div>
	);
};

export default PluginInstallList;
