import React, { useRef, useEffect } from 'react';
import { sortBy } from 'underscore';
import { Search } from '@brainstormforce/starter-templates-components';
import { useNavigate } from 'react-router-dom';
import { __ } from '@wordpress/i18n';
import { decodeEntities } from '@wordpress/html-entities';
import { useStateValue } from '../../../store/store';
import './style.scss';
import { setURLParmsValue } from '../../../utils/url-params';
import { useFilteredSites } from '..';

const SiteSearch = ( { setSiteData } ) => {
	const [
		{
			siteSearchTerm,
			searchTerms,
			searchTermsWithCount,
			builder,
			siteType,
			siteOrder,
			spectraBlocksVersion,
			stagingConnected,
		},
		dispatch,
	] = useStateValue();
	const allFilteredSites = useFilteredSites();
	const history = useNavigate();

	const collectTerms = ( count ) => {
		const term = siteSearchTerm.toLowerCase();
		const allTerms = searchTerms;
		const allTermsWithCount = searchTermsWithCount;
		// Skip blank words and words smaller than 3 characters.
		if ( '' === term || term.length < 3 ) {
			return;
		}

		if ( ! searchTerms.includes( term ) ) {
			allTerms.push( term );
			allTermsWithCount.push( {
				term,
				count,
			} );
			dispatch( {
				type: 'set',
				searchTerms: allTerms,
				searchTermsWithCount: allTermsWithCount,
			} );
		}
	};

	const ref = useRef();
	const parentRef = useRef();
	const isFirstRender = useRef( true );
	const lastSearchTerm = useRef( siteSearchTerm );

	// The API `type` filter returns an incomplete result set (it drops newer
	// templates), so fetch without it and filter by type client-side via the
	// intersection with the already type-filtered sites.
	const searchParams = new URLSearchParams( {
		search: siteSearchTerm,
		'page-builder': builder,
	} );
	if ( stagingConnected ) {
		searchParams.append( 'draft', 'yes' );
	}
	const apiUrl = `${
		astraSitesVars?.ApiDomain
	}wp-json/starter-templates/v2/sites-search/?${ searchParams.toString() }`;

	// Build the site list from a search API response, intersected with the
	// currently filtered sites (type, Spectra version).
	const processSearchResponse = ( response ) => {
		// When ordered by latest, the filtered sites are an array — index it
		// back by `id-{N}` so search results can be looked up.
		const sitesMap = Array.isArray( allFilteredSites )
			? allFilteredSites.reduce( ( acc, site ) => {
					if ( site?.id ) {
						acc[ `id-${ site.id }` ] = site;
					}
					return acc;
			  }, {} )
			: allFilteredSites;

		let results = {};
		if ( response.success && response.ids?.length ) {
			for ( const id of response.ids ) {
				if (
					Object.prototype.hasOwnProperty.call( sitesMap, id ) &&
					sitesMap[ id ]
				) {
					const selectedTemplate = sitesMap[ id ];
					if (
						selectedTemplate.related_ecommerce_template !==
							undefined &&
						selectedTemplate.related_ecommerce_template !== '' &&
						selectedTemplate.ecommerce_parent_template !==
							undefined &&
						selectedTemplate.ecommerce_parent_template !== ''
					) {
						// If ecommerce_parent_template is not empty, skip adding the site to allSites.
						continue;
					}
					results[ id ] = sitesMap[ id ];
				}
			}
		}

		// Keep API relevance order for "popular"; sort by publish date for
		// "latest" (same sort as the browse path in useFilteredSites).
		if ( siteOrder === 'latest' ) {
			results = Object.fromEntries(
				sortBy(
					Object.entries( results ),
					( entry ) => entry[ 1 ][ 'publish-date' ]
				).reverse()
			);
		}

		collectTerms( Object.keys( results ).length );

		setSiteData( {
			sites: results,
			gridSkeleton: false,
		} );
	};

	// Re-run the active search when the builder, site type, Spectra version,
	// or sort order changes so the results reflect the new selection instead
	// of the full unfiltered list.
	useEffect( () => {
		if ( isFirstRender.current ) {
			isFirstRender.current = false;
			return;
		}
		if ( ! siteSearchTerm ) {
			return;
		}
		// When the term changed in the same update (e.g. a mega-menu click sets
		// both the term and the order), the Search component's own debounced
		// fetch handles it — skip to avoid a duplicate request.
		if ( lastSearchTerm.current !== siteSearchTerm ) {
			return;
		}
		const controller = new AbortController();
		setSiteData( { gridSkeleton: true } );
		fetch( apiUrl, { signal: controller.signal } )
			.then( ( res ) => res.json() )
			.then( ( response ) => {
				// Drop the response if the term changed (cleared or retyped)
				// while the request was in flight — the term's own flow owns
				// the grid now.
				if ( lastSearchTerm.current !== siteSearchTerm ) {
					return;
				}
				processSearchResponse( response );
			} )
			.catch( ( error ) => {
				if ( error?.name === 'AbortError' ) {
					return;
				}
				// Show an empty state instead of the previous selection's
				// results.
				setSiteData( { sites: {}, gridSkeleton: false } );
			} );
		// Abort the in-flight request when the selection changes again or the
		// component unmounts, so a stale response can't overwrite newer
		// results or write state after unmount.
		return () => controller.abort();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ builder, siteType, spectraBlocksVersion, siteOrder ] );

	// Track the latest term after the effect above has run, so it can detect
	// a same-update term change.
	useEffect( () => {
		lastSearchTerm.current = siteSearchTerm;
	}, [ siteSearchTerm ] );

	const handleScroll = ( event ) => {
		event.preventDefault();

		if ( ref && parentRef ) {
			const header = document.querySelector( '.site-list-header' );
			let topCross = 0;
			if ( header && header.clientHeight ) {
				topCross = header.clientHeight;
			}

			// Remove the search box height too.
			topCross = topCross - ref.current.clientHeight;

			// Check the search wrapper scrool top.
			const parentTop =
				parentRef.current.getBoundingClientRect().top || 0;
			if ( parentTop <= topCross ) {
				document.body.classList.add( 'st-search-box-fixed' );
			} else {
				document.body.classList.remove( 'st-search-box-fixed' );
			}
		}
	};

	useEffect( () => {
		document
			.querySelector( '.step-content' )
			?.addEventListener( 'scroll', handleScroll );
		return () =>
			document
				.querySelector( '.step-content' )
				?.removeEventListener( 'scroll', handleScroll );
	}, [] );

	const onSearchKeyUp = ( event ) => {
		event.preventDefault();
		const content = document.querySelector( '.st-templates-content' );
		const top = content
			? parseInt( content.getBoundingClientRect().top )
			: 0;
		if (
			top < 0 &&
			32 !== event.keyCode &&
			16 !== event.keyCode &&
			17 !== event.keyCode &&
			18 !== event.keyCode
		) {
			const header = document.querySelector( '.site-list-header' );
			const headerHeight = header ? parseInt( header.clientHeight ) : 0;
			document.querySelector( '.step-content' ).scrollTo( {
				behavior: 'smooth',
				left: 0,
				top: content.offsetTop - headerHeight - 20,
			} );
		}
	};
	return (
		<div className="st-search-box-wrap" ref={ parentRef }>
			<div className="st-search-filter st-search-box" ref={ ref }>
				<Search
					apiUrl={ apiUrl }
					beforeSearchResult={ () => {
						if ( ! siteSearchTerm ) {
							return;
						}
						setSiteData( {
							gridSkeleton: true,
						} );
					} }
					onSearchResult={ ( response ) => {
						if ( ! siteSearchTerm ) {
							setSiteData( {
								gridSkeleton: false,
							} );
							return;
						}
						processSearchResponse( response );
					} }
					value={ decodeEntities( siteSearchTerm ) }
					placeholder={ __(
						'Search for Starter Templates',
						'astra-sites'
					) }
					onSearch={ ( event, newSearchTerm ) => {
						const newSiteData = {
							gridSkeleton: true,
						};

						if ( ! newSearchTerm ) {
							newSiteData.sites = allFilteredSites;
						}

						setSiteData( newSiteData );

						dispatch( {
							type: 'set',
							siteSearchTerm: newSearchTerm,
							onMyFavorite: false,
							siteBusinessType: '',
							selectedMegaMenu: '',
							siteType: '',
							siteOrder: 'popular',
						} );
						const urlParam = setURLParmsValue( 's', newSearchTerm );
						history( `?${ urlParam }` );
					} }
					onKeyUp={ onSearchKeyUp }
				/>
			</div>
		</div>
	);
};

export default SiteSearch;
