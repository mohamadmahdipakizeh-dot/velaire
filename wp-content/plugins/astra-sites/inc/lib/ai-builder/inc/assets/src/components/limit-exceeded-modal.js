import { useSelect, useDispatch } from '@wordpress/data';
import { renderToString } from '@wordpress/element';
import { ExclamationTriangleColorfulIcon } from '../ui/icons';
import { STORE_KEY } from '../store';
import Modal from './modal';
import ModalTitle from './modal-title';
import Button from './button';
import { __, sprintf } from '@wordpress/i18n';
import { escapeHTML } from '@wordpress/escape-html';

const LimitExceedModal = ( { onOpenChange, openTarget = '_blank' } ) => {
	const { setLimitExceedModal } = useDispatch( STORE_KEY );

	const { limitExceedModal } = useSelect( ( select ) => {
		const { getLimitExceedModalInfo } = select( STORE_KEY );

		return {
			limitExceedModal: getLimitExceedModalInfo(),
		};
	} );

	const rawTeamName = aiBuilderVars?.zip_plans?.team?.name || '';
	const rawPlanName = aiBuilderVars?.zip_plans?.active_plan?.slug || '';
	const teamName =
		escapeHTML( rawTeamName ) || __( 'your team', 'ai-builder' );
	const planName =
		escapeHTML( rawPlanName ) || __( 'your current plan', 'ai-builder' );

	const mainContentTemplate =
		aiBuilderVars?.filtered_data?.main_content || '';
	const secondaryContentTemplate =
		aiBuilderVars?.filtered_data?.secondary_content || '';

	const teamPlanInfo = (
		<span
			dangerouslySetInnerHTML={ {
				__html: sprintf(
					mainContentTemplate,
					`<strong>${ teamName }</strong>`,
					`<strong>${ planName }</strong>`
				),
			} }
		/>
	);

	const dailyLimit = (
		<span className="zw-base-semibold text-app-heading ">
			{ sprintf(
				/* translators: %s: daily limit */
				__( '%s AI sites', 'ai-builder' ),
				aiBuilderVars?.zip_plans?.plan_data?.limit?.ai_sites_count_daily
			) }
		</span>
	);

	const aiSitesCount =
		aiBuilderVars?.zip_plans?.plan_data?.remaining?.ai_sites_count_daily;

	const displayMessage = (
		<span
			dangerouslySetInnerHTML={ {
				__html:
					typeof aiSitesCount === 'number' && aiSitesCount <= 0
						? `
				<br />
					${ sprintf(
						/* translators: %s: daily limit */
						__(
							'This plan allows you to generate %s per day, and you have reached this limit.',
							'ai-builder'
						),
						renderToString( dailyLimit )
					) }
					<br />
					<br />
					${ __(
						'To create more AI websites, you will need to either upgrade your plan or wait until the limit resets.',
						'ai-builder'
					) }
				`
						: `
				<br />
				<br />
				 ${ sprintf( secondaryContentTemplate, `<strong>${ teamName }</strong>` ) }
          		<br />
				`,
			} }
		/>
	);

	return (
		<Modal
			open={ limitExceedModal.open }
			setOpen={ ( toggle ) => {
				if ( typeof onOpenChange === 'function' ) {
					onOpenChange( toggle );
				}

				setLimitExceedModal( {
					...limitExceedModal,
					open: toggle,
				} );
			} }
			width={ 464 }
			height="200"
			overflowHidden={ false }
		>
			<ModalTitle>
				<ExclamationTriangleColorfulIcon className="w-6 h-6" />
				<span>{ __( 'Limit reached', 'ai-builder' ) }</span>
			</ModalTitle>
			<div className="space-y-8">
				<div className="text-app-text text-base leading-6">
					<div>
						{ teamPlanInfo }
						{ displayMessage }
					</div>
				</div>
				<Button
					variant="primary"
					size="base"
					className="w-full"
					onClick={ () => {
						setLimitExceedModal( {
							...limitExceedModal,
							open: false,
						} );
						if ( typeof window === 'undefined' ) {
							return;
						}
						window.open(
							aiBuilderVars?.filtered_data?.upgrade_url,
							openTarget
						);
					} }
				>
					{ aiBuilderVars?.filtered_data?.upgrade_text }
				</Button>
			</div>
		</Modal>
	);
};

export default LimitExceedModal;
