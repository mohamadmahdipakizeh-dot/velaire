import { useState, useEffect, useRef, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { classNames } from '../helpers';

const { imageDir } = aiBuilderVars;

const AUTOPLAY_INTERVAL = 6000;

const FEATURE_CARDS = [
	{
		image: 'ai-site-builder',
		title: __( 'AI Site Builder', 'ai-builder' ),
		description: __(
			'Describe your business, get a full website.',
			'ai-builder'
		),
	},
	{
		image: 'ai-site-planner',
		title: __( 'AI Site Planner', 'ai-builder' ),
		description: __(
			'Plan your pages and structure before you build.',
			'ai-builder'
		),
	},
	{
		image: 'build-with-claude',
		title: __( 'Build with Claude, Host with ZipWP', 'ai-builder' ),
		description: __(
			"The world's best AI, with hosting built around it.",
			'ai-builder'
		),
	},
	{
		image: 'buy-domains',
		title: __( 'Buy Domains Directly', 'ai-builder' ),
		description: __(
			'Search, buy, and connect domains without leaving ZipWP.',
			'ai-builder'
		),
	},
	{
		image: 'premium-hosting',
		title: __( 'Premium Hosting', 'ai-builder' ),
		description: __(
			'Fast, secure hosting that grows with your site.',
			'ai-builder'
		),
	},
	{
		image: 'classic-templates',
		title: __( 'Classic Templates', 'ai-builder' ),
		description: __(
			'Prefer not to use AI? Start from a human-designed, conversion-ready template.',
			'ai-builder'
		),
	},
];

const FeatureCard = ( { card } ) => {
	const [ imgError, setImgError ] = useState( false );
	const imgSrc = `${ imageDir }/build-with-ai/carousel/${ card.image }.png`;

	return (
		<div className="flex-shrink-0 w-full flex justify-center">
			<article className="relative w-[520px] flex flex-col bg-white rounded-[20px] overflow-hidden p-[22px] pb-5 shadow-card">
				{ /* Gradient accent bar */ }
				<span className="absolute left-0 top-0 bottom-0 w-1 z-[3] bg-gradient-2" />

				{ /* Browser chrome screenshot area */ }
				<div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-[#f1f5f9] rounded-xl border border-[#e6eaf1]">
					<div className="flex-shrink-0 h-[30px] flex items-center gap-1.5 px-3.5 bg-white border-b border-[#eef1f6]">
						<i className="w-[9px] h-[9px] rounded-full bg-[#e2e8f0]" />
						<i className="w-[9px] h-[9px] rounded-full bg-[#e2e8f0]" />
						<i className="w-[9px] h-[9px] rounded-full bg-[#e2e8f0]" />
					</div>
					<div className="flex-1 overflow-hidden min-h-0 h-[300px]">
						{ ! imgError ? (
							<img
								src={ imgSrc }
								alt={ card.title }
								className="w-full h-full object-cover object-top block"
								onError={ () => setImgError( true ) }
							/>
						) : (
							<div className="w-full h-full bg-gradient-to-br from-[#f8f9ff] via-[#f0f0ff] to-[#e8e8ff]" />
						) }
					</div>
				</div>

				{ /* Card meta */ }
				<div className="pt-3.5">
					<h3 className="m-0 mb-1 text-lg font-bold tracking-tight text-[#0f172a]">
						{ card.title }
					</h3>
					<p className="m-0 text-sm leading-snug text-[#64748b]">
						{ card.description }
					</p>
				</div>
			</article>
		</div>
	);
};

const FeatureCarousel = () => {
	const cards = FEATURE_CARDS;
	const [ activeIndex, setActiveIndex ] = useState( 0 );
	const [ isPaused, setIsPaused ] = useState( false );
	const timerRef = useRef( null );

	const startAutoplay = useCallback( () => {
		if ( timerRef.current ) {
			clearInterval( timerRef.current );
		}
		timerRef.current = setInterval( () => {
			setActiveIndex( ( prev ) => ( prev + 1 ) % cards.length );
		}, AUTOPLAY_INTERVAL );
	}, [ cards.length ] );

	const stopAutoplay = useCallback( () => {
		if ( timerRef.current ) {
			clearInterval( timerRef.current );
			timerRef.current = null;
		}
	}, [] );

	useEffect( () => {
		if ( ! isPaused ) {
			startAutoplay();
		}
		return stopAutoplay;
	}, [ isPaused, startAutoplay, stopAutoplay ] );

	const handleMouseEnter = () => {
		setIsPaused( true );
		stopAutoplay();
	};

	const handleMouseLeave = () => {
		setIsPaused( false );
	};

	const handleDotClick = ( index ) => {
		setActiveIndex( index );
		startAutoplay();
	};

	return (
		<div
			onMouseEnter={ handleMouseEnter }
			onMouseLeave={ handleMouseLeave }
			className="flex flex-col items-center gap-5"
		>
			{ /* Viewport */ }
			<div className="w-[400px] overflow-hidden rounded-[20px]">
				<div
					className="flex transition-transform duration-[250ms] ease-in-out"
					style={ {
						transform: `translateX(-${ activeIndex * 100 }%)`,
					} }
				>
					{ cards.map( ( card, index ) => (
						<FeatureCard key={ index } card={ card } />
					) ) }
				</div>
			</div>

			{ /* Dot navigation */ }
			<div className="flex items-center justify-center gap-2">
				{ cards.map( ( _, index ) => (
					<button
						key={ index }
						type="button"
						onClick={ () => handleDotClick( index ) }
						className={ classNames(
							'h-2 border-0 rounded-full p-0 cursor-pointer transition-all duration-[280ms]',
							index === activeIndex
								? 'w-6 bg-gradient-1'
								: 'w-2 bg-[#cbd5e1] hover:bg-[#94a3b8]'
						) }
						aria-label={ `${ index + 1 }` }
					/>
				) ) }
			</div>
		</div>
	);
};

export { FEATURE_CARDS };
export default FeatureCarousel;
