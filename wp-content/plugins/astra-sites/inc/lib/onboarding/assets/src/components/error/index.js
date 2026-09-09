import React, { useState, useEffect } from 'react';
import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
import { useStateValue } from '../../store/store';
import Button from '../../components/button/button';
import './style.scss';
import { getSupportLink } from '../../utils/functions';
import { safeParseJson } from '../../steps/import-site/import-utils';

const ErrorScreen = () => {
	const [
		{ importErrorMessages, currentIndex, tryAgainCount, templateId },
		dispatch,
	] = useStateValue();

	const [ importLogUrl, setImportLogUrl ] = useState( '' );

	useEffect( () => {
		if ( ! astraSitesVars?._ajax_nonce ) {
			return;
		}
		const controller = new AbortController();
		const formData = new FormData();
		formData.append( 'action', 'astra-sites-get-import-log-url' );
		formData.append( '_ajax_nonce', astraSitesVars._ajax_nonce );
		fetch( astraSitesVars?.ajaxurl, {
			method: 'POST',
			body: formData,
			signal: controller.signal,
		} )
			.then( safeParseJson )
			.then( ( r ) => {
				const url = r?.data?.import_log_url;
				if (
					r.success &&
					url &&
					url.startsWith( window.location.origin )
				) {
					setImportLogUrl( url );
				}
			} )
			// eslint-disable-next-line no-console -- Intentionally silent in production; logged for debugging.
			.catch( ( err ) => {
				if ( err.name !== 'AbortError' ) {
					console.warn(
						'[Astra Sites] Could not fetch import log URL:',
						err
					);
				}
			} );
		return () => controller.abort();
	}, [] );

	const supportLink = getSupportLink(
		templateId,
		importErrorMessages.errorText
	);

	const tryAgain = () => {
		dispatch( {
			type: 'set',
			// Reset errors.
			importErrorMessages: {},
			importErrorResponse: [],
			importError: false,

			// Try again count.
			tryAgainCount: tryAgainCount + 1,

			// Reset import flags.
			xmlImportDone: false,
			resetData: [],
			importStart: false,
			importEnd: false,
			importPercent: 0,
			requiredPluginsDone: false,
			notInstalledList: [],
			notActivatedList: [],

			// Flag to prevent premature requiredPluginsDone while checking plugins.
			awaitingPluginCheck: true,

			// Go to previous step.
			currentIndex: currentIndex - 1,
		} );
	};

	const solutionHeading = (
		<h5 className="ist-import-error-solution-heading">
			{ __( 'Still no luck? Other potential solution:', 'astra-sites' ) }
		</h5>
	);

	return (
		<div className="ist-import-error">
			<div className="ist-import-progress-info">
				<div className="ist-import-progress-info-text label-text">
					{ __( 'Sorry, something went wrong.', 'astra-sites' ) }
				</div>
			</div>
			<div className="ist-import-error-box">
				<h5 className="ist-import-error-box-heading">
					{ __( 'What went wrong?', 'astra-sites' ) }
				</h5>
				<div className="ist-import-error-wrap ist-import-error-primary-wrap">
					{ importErrorMessages.primaryText && (
						<p className="website-import-subtitle">
							{ importErrorMessages.primaryText }
						</p>
					) }
				</div>
				{ importErrorMessages.secondaryText && (
					<div className="ist-import-error-wrap ist-import-error-secondary-wrap">
						{ importErrorMessages.secondaryText && (
							<p
								dangerouslySetInnerHTML={ {
									__html: importErrorMessages.secondaryText,
								} }
							/>
						) }
					</div>
				) }
				<div className="ist-import-error-wrap ist-import-error-text-wrap">
					<h5 className="ist-import-error-text-heading">
						{ __(
							'More technical information from console:',
							'astra-sites'
						) }
					</h5>
					{ importErrorMessages.errorText &&
						'object' !== typeof importErrorMessages.errorText && (
							<p className="ist-import-error-text">
								{ importErrorMessages.errorText }
							</p>
						) }
					{ importErrorMessages.errorText &&
						'object' === typeof importErrorMessages.errorText && (
							<div className="ist-import-error-text">
								<pre>
									{ JSON.stringify(
										importErrorMessages.errorText,
										undefined,
										2
									) }
								</pre>
							</div>
						) }
				</div>
			</div>
			{ importLogUrl && (
				<div className="ist-import-error-log-wrap">
					<a
						href={ importLogUrl }
						target="_blank"
						rel="noreferrer"
						className="ist-import-error-log-link"
					>
						{ __( 'View import log', 'astra-sites' ) }
					</a>
				</div>
			) }
			{ importErrorMessages.tryAgain && tryAgainCount < 3 && (
				<Button
					className="ist-button"
					after={ true }
					onClick={ tryAgain }
				>
					{ __( 'Click here and we’ll try again', 'astra-sites' ) }
				</Button>
			) }
			<div className="ist-import-error-solution-wrapper">
				{ importErrorMessages.solutionText && (
					<>
						{ solutionHeading }
						<p
							className="ist-import-error-solution"
							dangerouslySetInnerHTML={ {
								__html: importErrorMessages.solutionText,
							} }
						/>
					</>
				) }
				{ ( ! importErrorMessages.solutionText &&
					! importErrorMessages.tryAgain ) ||
					( importErrorMessages.tryAgain && tryAgainCount > 1 && (
						<>
							{ solutionHeading }
							<p className="ist-import-error-solution">
								{ decodeEntities(
									__(
										'Please report this error&nbsp;',
										'astra-sites'
									)
								) }
								<a
									href={ supportLink }
									target="_blank"
									rel="noreferrer"
								>
									{ 'here' }
								</a>
								{ decodeEntities(
									__(
										'&nbsp;so we can fix it.',
										'astra-sites'
									)
								) }
							</p>
						</>
					) ) }
			</div>
		</div>
	);
};

export default ErrorScreen;
