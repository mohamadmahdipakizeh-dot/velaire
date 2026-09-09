import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import toast from 'react-hot-toast';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { toastBody } from '../helpers';
import Button from './button';

const AUTO_RESTORE_GRACE_MS = 2 * 60 * 1000;

/**
 * Credit-restore panel shown on a failed build.
 *
 * @param {Object}  props
 * @param {boolean} props.autoRestore When true (a backend-confirmed failure) the
 *                                    credit is auto-restored server-side, so we
 *                                    reassure accordingly. When false (a client
 *                                    stall where the backend may still be running)
 *                                    we avoid promising a restore that may not
 *                                    have happened.
 */
const CreditRestoreNotice = ( { autoRestore = true } ) => {
	const [ isLoading, setIsLoading ] = useState( false );
	const [ hasRestored, setHasRestored ] = useState( false );
	const [ notEligible, setNotEligible ] = useState( false );
	const [ manualEnabled, setManualEnabled ] = useState( false );

	useEffect( () => {
		const timer = setTimeout(
			() => setManualEnabled( true ),
			AUTO_RESTORE_GRACE_MS
		);
		return () => clearTimeout( timer );
	}, [] );

	const handleRestore = async () => {
		if ( isLoading || hasRestored || notEligible ) {
			return;
		}

		setIsLoading( true );
		try {
			const response = await apiFetch( {
				path: 'zipwp/v1/restore-credit',
				method: 'POST',
				headers: {
					'X-WP-Nonce': aiBuilderVars.rest_api_nonce,
					_ajax_nonce: aiBuilderVars._ajax_nonce,
				},
			} );

			const restore = response?.data?.data;
			const status = restore?.status;
			// The backend returns accurate, status-specific copy — prefer it.
			const message = restore?.message;

			if ( ! response?.success || ! status ) {
				throw new Error( 'restore-failed' );
			}

			if ( status === 'restored_now' || status === 'already_restored' ) {
				setHasRestored( true );
				toast.success(
					toastBody( {
						title:
							status === 'already_restored'
								? __( 'Credit already restored', 'ai-builder' )
								: __( 'Credit restored', 'ai-builder' ),
						message:
							message ||
							__(
								'Your credit has been restored. You can try again.',
								'ai-builder'
							),
					} )
				);
			} else {
				// not_eligible (or any non-restore status): nothing was deducted
				// or no failure was recorded — do not imply a pending restore.
				setNotEligible( true );
				toast(
					toastBody( {
						title: __( 'No credit to restore', 'ai-builder' ),
						message:
							message ||
							__(
								"We couldn't find a credit deduction for this site. If you were charged, please contact support.",
								'ai-builder'
							),
					} )
				);
			}
		} catch ( error ) {
			toast.error(
				toastBody( {
					title: __( 'Restore failed', 'ai-builder' ),
					message: __(
						'Could not restore your credit. Please try again or contact support.',
						'ai-builder'
					),
				} )
			);
		} finally {
			setIsLoading( false );
		}
	};

	const buttonLabel = () => {
		if ( hasRestored ) {
			return __( 'Credit restored', 'ai-builder' );
		}
		if ( notEligible ) {
			return __( 'No credit to restore', 'ai-builder' );
		}
		if ( isLoading ) {
			return __( 'Restoring…', 'ai-builder' );
		}
		return __( 'Restore credit', 'ai-builder' );
	};

	const noticeText = autoRestore
		? __(
				"Don't worry — the credit used for this site is being restored to your account automatically. This usually takes under a minute.",
				'ai-builder'
		  )
		: __(
				'If a credit was used for this attempt, it will be restored to your account. Tap Restore credit to check the status.',
				'ai-builder'
		  );

	return (
		<div className="flex items-start gap-2 rounded-md bg-gray-100 p-3">
			<InformationCircleIcon className="w-5 h-5 mt-0.5 text-app-secondary shrink-0" />
			<div className="flex flex-col gap-2 flex-1">
				<p className="zw-sm-normal text-app-text">{ noticeText }</p>
				<Button
					variant="white"
					isSmall
					className="self-start"
					onClick={ handleRestore }
					disabled={
						! manualEnabled ||
						isLoading ||
						hasRestored ||
						notEligible
					}
				>
					{ buttonLabel() }
				</Button>
			</div>
		</div>
	);
};

export default CreditRestoreNotice;
