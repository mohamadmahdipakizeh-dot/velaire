import { useState } from '@wordpress/element';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { CheckIcon } from '@heroicons/react/24/outline';

import { STORE_KEY } from '../store';
import Modal from './modal';
import Button from './button';
import LoadingSpinner from './loading-spinner';

const { imageDir } = aiBuilderVars;

const SignupLoginModal = () => {
	const { setSignupLoginModal } = useDispatch( STORE_KEY );
	const { signupLoginModal } = useSelect( ( select ) => {
		const { getSignupLoginModalInfo } = select( STORE_KEY );
		return {
			signupLoginModal: getSignupLoginModalInfo(),
		};
	}, [] );

	const { zipwp_auth } = wpApiSettings || {};
	const { screen_url, redirect_url, source, utmSource, partner_id } =
		zipwp_auth || {};
	const { isPremiumTemplate, context } = signupLoginModal || {};

	const isImagesContext = context === 'images';
	const [ isRedirecting, setIsRedirecting ] = useState( false );

	const handleClickNext = ( ask = 'register' ) => {
		setIsRedirecting( true );

		if ( ! screen_url || ! redirect_url || ! source ) {
			setIsRedirecting( false );
			return;
		}

		const encodedRedirectUrl = encodeURIComponent(
			redirect_url +
				'&should_resume=1&security=' +
				aiBuilderVars.zipwp_auth_nonce
		);

		const currentUrl = window.location.href;
		const currentUrlObj = new URL( currentUrl );
		currentUrlObj.hash = '';

		currentUrlObj.searchParams.set( 'should_resume', '1' );
		currentUrlObj.searchParams.set( 'skip_redirect_last_step', '1' );

		currentUrlObj.hash = '/design';

		const newUrl = currentUrlObj.toString();

		let url = `${ screen_url }?type=token&redirect_url=${ encodedRedirectUrl }&ask=/${ ask }&source=${ encodeURIComponent(
			source
		) }${
			partner_id ? `&aff=${ encodeURIComponent( partner_id ) }` : ''
		}&utm_source=${ encodeURIComponent(
			utmSource
		) }&utm_medium=plugin&utm_campaign=build-with-ai&utm_content=start-building`;

		if ( isPremiumTemplate ) {
			url += `&premium_design=true&change_design_redirect=${ encodeURIComponent(
				newUrl
			) }`;
		}

		window.location.href = url;
		setSignupLoginModal( { open: false } );
	};

	const handleCloseModal = () => {
		setSignupLoginModal( { open: false } );
	};

	return (
		<Modal
			open={ signupLoginModal?.open }
			setOpen={ ( toggle, type ) => {
				if ( type === 'close-icon' ) {
					handleCloseModal();
				}
			} }
			width={ 480 }
			height="408"
			overflowHidden={ false }
			className={ 'px-8 pt-8 pb-5 font-sans' }
		>
			<div>
				<div className="flex items-center gap-3">
					{ /* <ClipboardIcon className="w-8 h-8 text-accent-st" /> */ }
					<img
						width={ 237 }
						src={ `${ imageDir }/st-zipwp-logo.png` }
						alt=""
					/>
				</div>

				<div className="mt-6">
					<div className="text-zip-body-text text-base font-normal leading-6 flex flex-col space-y-4">
						<h2 className="font-bold leading-6">
							{ isImagesContext
								? __(
										'Connect ZipWP to access images',
										'ai-builder'
								  )
								: __(
										'Great Job! Your Site is Ready! 🎉',
										'ai-builder'
								  ) }
						</h2>

						<p className="text-base text-light-theme-text-inactive font-normal leading-5">
							{ isImagesContext
								? __(
										'Sign up for a free ZipWP account to load curated images for your region and finish building your website.',
										'ai-builder'
								  )
								: __(
										'Sign up for a free ZipWP account to import and customize your website!',
										'ai-builder'
								  ) }
						</p>
					</div>
					<div className="mt-5">
						<ul className="list-none space-y-2">
							<li className="flex items-center text-base leading-5 font-normal">
								<CheckIcon
									strokeWidth={ 2 }
									className="w-5 h-5 text-light-theme-highlight-cta mr-2"
								/>
								<span className="text-black">
									{ __(
										'Customize your website with ease',
										'ai-builder'
									) }
								</span>
							</li>
							<li className="flex items-center">
								<CheckIcon
									strokeWidth={ 2 }
									className="w-5 h-5 text-light-theme-highlight-cta mr-2"
								/>
								<span className="text-black">
									{ __(
										'Launch faster than ever',
										'ai-builder'
									) }
								</span>
							</li>
							<li className="flex items-center">
								<CheckIcon
									strokeWidth={ 2 }
									className="w-5 h-5 text-light-theme-highlight-cta mr-2"
								/>
								<span className="text-black">
									{ __(
										"Need help? We're a message away",
										'ai-builder'
									) }
								</span>
							</li>
						</ul>
					</div>
					<div className="flex items-center gap-3 justify-center mt-9 flex-col">
						<Button
							type="submit"
							variant="primary"
							size="medium"
							className="min-w-full h-[40px] text-sm font-semibold leading-5 px-5 w-full xs:w-auto"
							disabled={ isRedirecting }
							onClick={ () => {
								handleClickNext( 'register' );
							} }
						>
							{ isRedirecting ? (
								<LoadingSpinner />
							) : (
								__( 'Create ZipWP Account', 'ai-builder' )
							) }
						</Button>
						<span className="text-sm">
							{ __( 'Already have an account?', 'ai-builder' ) }{ ' ' }
							<button
								type="button"
								className={ `bg-transparent border-0 p-0 text-sm text-accent-st focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-st focus-visible:ring-offset-1 rounded ${
									isRedirecting
										? 'pointer-events-none opacity-50'
										: 'cursor-pointer hover:underline'
								}` }
								disabled={ isRedirecting }
								onClick={ () => {
									handleClickNext( 'login' );
								} }
							>
								{ __( 'Click here to login.', 'ai-builder' ) }
							</button>
						</span>
					</div>
				</div>
			</div>
		</Modal>
	);
};

export default SignupLoginModal;
