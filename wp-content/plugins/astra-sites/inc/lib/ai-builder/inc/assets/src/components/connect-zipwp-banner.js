import { __ } from '@wordpress/i18n';
import { ArrowRightIcon, PhotoIcon } from '@heroicons/react/24/outline';

import { useZipWPAuthPopup } from '../hooks/use-zipwp-auth-popup';
import Button from './button';
import LoadingSpinner from './loading-spinner';

/**
 * Banner shown on the image selection screen when the user is not connected
 * to ZipWP and the active image engine requires authentication (Freepik for
 * Russian users). Replaces the empty image grid state inside the Search
 * Results tab with a clear CTA to connect ZipWP, plus a fallback action to
 * jump straight to the Upload Your Images tab.
 *
 * Clicking the primary CTA opens the ZipWP auth popup directly — no
 * intermediate signup-login modal — so the flow is one click instead of two.
 *
 * @since 1.2.77
 *
 * @param {Object}   props               Component props.
 * @param {Function} props.onAuthSuccess Callback fired after the user
 *                                       successfully authenticates with
 *                                       ZipWP (token persisted).
 * @param {Function} props.onUploadOwn   Callback fired when the user clicks
 *                                       the "Upload your own" CTA. Should
 *                                       switch the active tab to the upload
 *                                       tab in the parent screen.
 * @return {JSX.Element} Rendered banner.
 */
const ConnectZipWPBanner = ( { onAuthSuccess, onUploadOwn } ) => {
	const { openPopup, isAuthLoading } = useZipWPAuthPopup( {
		onAuthSuccess,
	} );

	return (
		<div className="flex flex-col items-center justify-center gap-3 sm:gap-4 mx-auto w-full max-w-md text-center px-4 sm:px-6 py-6 sm:py-8 bg-[#F5F4FB] border border-solid border-border-tertiary rounded-xl">
			<div className="relative w-12 h-12">
				<div className="flex items-center justify-center w-full h-full rounded-lg bg-white shadow-sm border border-border-tertiary">
					<PhotoIcon
						className="w-6 h-6 text-accent-st"
						strokeWidth={ 1.75 }
					/>
				</div>
			</div>

			<div className="space-y-1 max-w-sm">
				<h3 className="m-0 text-base font-semibold text-zip-app-heading leading-6">
					{ __(
						'Connect ZipWP to load images for your region',
						'ai-builder'
					) }
				</h3>
				<p className="m-0 text-xs leading-5 text-zip-body-text">
					{ __(
						'Image search uses an API key from your ZipWP account. Connect a free account to load images available in your region.',
						'ai-builder'
					) }
				</p>
			</div>

			<div className="flex flex-col items-center gap-2 w-full max-w-[16rem]">
				<Button
					type="button"
					variant="primary"
					isSmall={ true }
					hasSuffixIcon={ ! isAuthLoading }
					className="w-full text-sm font-semibold leading-5"
					disabled={ isAuthLoading }
					onClick={ () => {
						openPopup( 'register' );
					} }
				>
					{ isAuthLoading ? (
						<LoadingSpinner />
					) : (
						<>
							<span>{ __( 'Connect ZipWP', 'ai-builder' ) }</span>
							<ArrowRightIcon
								className="w-4 h-4"
								strokeWidth={ 2 }
							/>
						</>
					) }
				</Button>
				<span className="text-xs text-zip-body-text">
					{ __( 'Already have an account?', 'ai-builder' ) }{ ' ' }
					<button
						type="button"
						className={ `bg-transparent border-0 p-0 text-xs text-accent-st font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-st focus-visible:ring-offset-1 rounded ${
							isAuthLoading
								? 'opacity-50 cursor-not-allowed'
								: 'cursor-pointer hover:underline'
						}` }
						disabled={ isAuthLoading }
						onClick={ () => {
							openPopup( 'login' );
						} }
					>
						{ __( 'Log in', 'ai-builder' ) }
					</button>
				</span>
			</div>

			<div className="flex items-center gap-2 w-full max-w-[16rem]">
				<span className="flex-1 h-px bg-border-tertiary" />
				<span className="text-[0.6875rem] font-medium tracking-[0.15em] text-zip-body-text uppercase">
					{ __( 'OR', 'ai-builder' ) }
				</span>
				<span className="flex-1 h-px bg-border-tertiary" />
			</div>

			<Button
				type="button"
				variant="white"
				isSmall={ true }
				className="w-full max-w-[16rem] text-sm font-semibold leading-5 !bg-white !text-zip-app-heading !border-border-tertiary hover:!border-accent-st hover:!text-accent-st"
				disabled={ isAuthLoading }
				onClick={ () => {
					if ( typeof onUploadOwn === 'function' ) {
						onUploadOwn();
					}
				} }
			>
				{ __( 'Upload your own', 'ai-builder' ) }
			</Button>
		</div>
	);
};

export default ConnectZipWPBanner;
