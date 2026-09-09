import { useState } from '@wordpress/element';
import { useDispatch, useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

import { STORE_KEY } from '../store';
import Modal from './modal';
import Button from './button';
import LoadingSpinner from './loading-spinner';

const { imageDir } = aiBuilderVars;

const ReconnectModal = () => {
	const { setReconnectModal } = useDispatch( STORE_KEY );
	const { reconnectModal } = useSelect( ( select ) => {
		const { getReconnectModalInfo } = select( STORE_KEY );
		return {
			reconnectModal: getReconnectModalInfo(),
		};
	}, [] );

	const { zipwp_auth } = wpApiSettings || {};
	const { screen_url, redirect_url, source, utmSource, partner_id } =
		zipwp_auth || {};

	const [ isRedirecting, setIsRedirecting ] = useState( false );

	const handleLogin = () => {
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

		const url = `${ screen_url }?type=token&redirect_url=${ encodedRedirectUrl }&ask=/login&source=${ encodeURIComponent(
			source
		) }${
			partner_id ? `&aff=${ encodeURIComponent( partner_id ) }` : ''
		}&utm_source=${ encodeURIComponent(
			utmSource
		) }&utm_medium=plugin&utm_campaign=build-with-ai&utm_content=reconnect`;

		window.location.href = url;
		setReconnectModal( { open: false } );
	};

	const handleClose = () => {
		setReconnectModal( { open: false } );
	};

	return (
		<Modal
			open={ reconnectModal?.open }
			setOpen={ ( toggle, type ) => {
				if ( type === 'close-icon' ) {
					handleClose();
				}
			} }
			width={ 480 }
			height="auto"
			overflowHidden={ false }
			className={ 'px-8 pt-8 pb-5 font-sans' }
		>
			<div>
				<div className="flex items-center gap-3">
					<img
						width={ 237 }
						src={ `${ imageDir }/st-zipwp-logo.png` }
						alt=""
					/>
				</div>

				<div className="mt-6">
					<div className="text-zip-body-text text-base font-normal leading-6 flex flex-col space-y-4">
						<h2 className="font-bold leading-6">
							{ __(
								'Reconnect Your ZipWP Account',
								'ai-builder'
							) }
						</h2>

						<p className="text-base text-light-theme-text-inactive font-normal leading-5">
							{ __(
								"Your account isn't linked to an active ZipWP team. Log in to create or join a team and continue building your website.",
								'ai-builder'
							) }
						</p>
					</div>

					<div className="flex items-center gap-3 justify-center mt-9 flex-col">
						<Button
							type="submit"
							variant="primary"
							size="medium"
							className="min-w-full h-[40px] text-sm font-semibold leading-5 px-5 w-full xs:w-auto"
							disabled={ isRedirecting }
							onClick={ handleLogin }
						>
							{ isRedirecting ? (
								<LoadingSpinner />
							) : (
								__( 'Reconnect to ZipWP', 'ai-builder' )
							) }
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
};

export default ReconnectModal;
