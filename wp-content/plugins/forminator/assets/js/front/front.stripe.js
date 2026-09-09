// the semi-colon before function invocation is a safety net against concatenated
// scripts and/or other plugins which may not be closed properly.
;// noinspection JSUnusedLocalSymbols
(function ($, window, document, undefined) {

	"use strict";

	// undefined is used here as the undefined global variable in ECMAScript 3 is
	// mutable (ie. it can be changed by someone else). undefined isn't really being
	// passed in so we can ensure the value of it is truly undefined. In ES5, undefined
	// can no longer be modified.

	// window and document are passed through as local variables rather than global
	// as this (slightly) quickens the resolution process and can be more efficiently
	// minified (especially when both are regularly referenced in your plugin).

	// Create the defaults once
	var pluginName = "forminatorFrontStripe",
	    defaults   = {
		    type: 'stripe',
		    paymentEl: null,
		    paymentRequireSsl: false,
		    generalMessages: {},
		    stripe_checkout_metadata_depends: [],
		    is_preview: '',
		    preview_data: [],
	    };

	// The actual plugin constructor
	function ForminatorFrontStripe(element, options) {
		this.element = element;
		this.$el     = $(this.element);

		// jQuery has an extend method which merges the contents of two or
		// more objects, storing the result in the first object. The first object
		// is generally empty as we don't want to alter the default options for
		// future instances of the plugin
		this.settings              = $.extend({}, defaults, options);
		this._defaults             = defaults;
		this._name                 = pluginName;
		this._stripeData           = null;
		this._stripe               = null;
		this._elements             = null;
		this._paymentElement       = null;
		this._checkout             = null;
		this._contactElement       = null;
		this._currencySelectorElement = null;
		this._mountPromise         = null;
		this._checkoutActions      = null;
		this._beforeSubmitCallback = null;
		this._form                 = null;
		this.intent                = true;
		this._lastMountFailed      = false;
		this._checkoutCanConfirm   = false;
		this._checkoutSyncPromise  = null;
		this._checkoutRefreshTimer = null;
		this._checkoutVisibilitySnapshot = '';
		this._checkoutRefreshRequestId = 0;
		this._checkoutMountRequestId = 0;
		this._returnedCheckoutSessionId = '';
		this._isCheckoutReturnFlow = false;
		this._checkoutReturnError = '';
		this.billingDetails        = {};
		this.init();
	}

	// Avoid Plugin.prototype conflicts
	$.extend(ForminatorFrontStripe.prototype, {
		// Include render_id so multiple embeds of the same form do not share Checkout storage.
		getCheckoutStorageKeyBase: function() {
			var formKey = this.$el.attr('id') || this.$el.data('form-id') || 'default';
			var renderId = this.$el.data('forminator-render') || this.$el.find('[name="render_id"]').val() || '';

			return renderId ? formKey + ':' + renderId : formKey;
		},

		// Build a storage key for the pending Stripe Checkout session ID.
		getCheckoutStorageKey: function() {
			return 'forminatorStripeCheckoutSession:' + this.getCheckoutStorageKeyBase();
		},

		// Build a storage key for the form values we want to restore after redirect.
		getCheckoutFormStateStorageKey: function() {
			return 'forminatorStripeCheckoutFormState:' + this.getCheckoutStorageKeyBase();
		},

		// Build a storage key for the form-scoped marker used to recognize clean external Checkout returns.
		getCheckoutReturnStateStorageKey: function() {
			return 'forminatorStripeCheckoutReturnState:' + this.getCheckoutStorageKeyBase();
		},

		// Mark the form that initiated an external Checkout redirect. Some methods, like Amazon Pay, can return without a session_id in the URL.
		storeCheckoutReturnState: function(paymentId) {
			if ( ! paymentId ) {
				return;
			}

			try {
				window.sessionStorage.setItem(
					this.getCheckoutReturnStateStorageKey(),
					JSON.stringify(
						{
							paymentId: paymentId,
							createdAt: Date.now(),
						}
					)
				);
			} catch ( error ) {
				// Ignore storage errors.
			}
		},

		getCheckoutReturnStateSessionId: function() {
			var returnState = null;

			try {
				returnState = JSON.parse(window.sessionStorage.getItem(this.getCheckoutReturnStateStorageKey()) || 'null');
			} catch ( error ) {
				return '';
			}

			if ( ! returnState || ! returnState.paymentId || ! returnState.createdAt ) {
				return '';
			}

			return returnState.paymentId;
		},

		clearCheckoutReturnState: function() {
			try {
				window.sessionStorage.removeItem(this.getCheckoutReturnStateStorageKey());
			} catch ( error ) {
				// Ignore storage errors.
			}
		},

		// Save the session ID so we can recognize the same Checkout flow when the user comes back.
		storePendingCheckoutSessionId: function(paymentId) {
			if ( ! paymentId ) {
				return;
			}

			try {
				window.sessionStorage.setItem(this.getCheckoutStorageKey(), paymentId);
			} catch ( error ) {
				// Ignore storage errors.
			}
		},

		// Read the returned session ID from the URL and match it to this form's pending session.
		getReturnedCheckoutSessionId: function() {
			var storedSessionId = '';

			try {
				storedSessionId = window.sessionStorage.getItem(this.getCheckoutStorageKey()) || '';
			} catch ( error ) {
				storedSessionId = '';
			}

			if ( ! this.isCheckoutSession() ) {
				return '';
			}

			var returnStateSessionId = this.getCheckoutReturnStateSessionId();

			if ( ! window.location.search ) {
				// Clean returns must match the explicit redirect marker, otherwise sibling forms with pending sessions could recover incorrectly.
				return storedSessionId && storedSessionId === returnStateSessionId ? storedSessionId : '';
			}

			try {
				var params = new window.URLSearchParams(window.location.search);
				var returnedSessionId = params.get('session_id') || '';

				if ( returnedSessionId ) {
					return storedSessionId === returnedSessionId ? returnedSessionId : '';
				}

				// Some Stripe redirect returns include status/error params without session_id; only then fall back to the form-scoped return marker.
				return (
					params.get('redirect_status')
					|| params.get('error')
					|| params.get('error_code')
					|| params.get('error_message')
					|| params.get('error_description')
				) && storedSessionId === returnStateSessionId ? storedSessionId : '';
			} catch ( error ) {
				return '';
			}
		},

		getCheckoutReturnErrorMessage: function() {
			if ( ! this.isCheckoutSession() || ! window.location.search ) {
				return '';
			}

			try {
				var params = new window.URLSearchParams(window.location.search);
				var errorMessage = params.get('error_description') || params.get('error_message') || '';
				var errorCode = params.get('error') || params.get('error_code') || '';
				var redirectStatus = params.get('redirect_status') || '';

				if ( errorMessage ) {
					return errorMessage;
				}

				if ( errorCode ) {
					return window.ForminatorFront.cform.payment_failed;
				}

				if ( redirectStatus && 'succeeded' !== redirectStatus ) {
					return 'canceled' === redirectStatus
						? window.ForminatorFront.cform.payment_cancelled
						: window.ForminatorFront.cform.payment_failed;
				}
			} catch ( error ) {
				return window.ForminatorFront.cform.payment_failed;
			}

			return '';
		},

		clearCheckoutReturnQueryParams: function() {
			if ( ! this.isCheckoutSession() || ! window.location.href || ! window.history || typeof window.history.replaceState !== 'function' ) {
				return;
			}

			try {
				var url = new window.URL(window.location.href);
				var paramsToClear = [ 'session_id', 'error', 'error_code', 'error_message', 'error_description', 'redirect_status' ];
				var hasChanges = false;

				paramsToClear.forEach(function(param) {
					if ( url.searchParams.has(param) ) {
						url.searchParams.delete(param);
						hasChanges = true;
					}
				});

				if ( hasChanges ) {
					var nextUrl = url.pathname + ( url.search ? url.search : '' ) + url.hash;
					window.history.replaceState({}, document.title, nextUrl);
				}
			} catch ( error ) {
				// Ignore URL rewrite errors.
			}
		},

		getStripeCheckoutErrorMessage: function(error) {
			var message = error && error.message ? error.message : '';

			if ( ! message ) {
				return window.ForminatorFront.cform.payment_failed;
			}

			if ( error && 'IntegrationError' === error.name ) {
				return window.ForminatorFront.cform.payment_failed;
			}

			return message;
		},

		// Clear the stored Checkout session ID after a successful submission.
		clearPendingCheckoutSessionId: function() {
			try {
				window.sessionStorage.removeItem(this.getCheckoutStorageKey());
			} catch ( error ) {
				// Ignore storage errors.
			}

			this.clearCheckoutReturnState();
		},

		// Drop the Checkout session state so the form can request a brand new session.
		clearRecoveredCheckoutSessionState: function() {
			this.clearPendingCheckoutSessionId();
			this.$el.find('#forminator-stripe-paymentid').val('');
			this._stripeData['paymentid'] = '';
			this._returnedCheckoutSessionId = '';
			this._isCheckoutReturnFlow = false;
		},

		// Save field values so the form can be restored after the Stripe redirect.
		storeCheckoutFormState: function() {
			var values = {};

			this.$el.find('input, select, textarea').each(function() {
				var $field = $(this);
				var name = $field.attr('name');
				var type = ( $field.attr('type') || '' ).toLowerCase();

				if (
					! name
					|| 'file' === type
					|| 'hidden' === type
					|| 'paymentid' === name
					|| 'paymentmethod' === name
					|| 'subscriptionid' === name
					|| 'save_draft' === name
				) {
					return;
				}

				if ( ( 'checkbox' === type || 'radio' === type ) && ! $field.is(':checked') ) {
					return;
				}

				if ( ! Array.isArray(values[name]) ) {
					values[name] = [];
				}

				values[name].push($field.val());
			});

			var repeaterGroups = [];
			this.$el.find('.forminator-all-group-copies').each(function() {
				var $groupField = $(this);
				var groupId = $groupField.closest('div[id^="group-"]').prop('id');
				var suffixes = [];

				if ( ! groupId ) {
					return;
				}

				$groupField.find('>.forminator-grouped-fields:not(:first-child)').each(function() {
					var suffix = $(this).data('suffix');
					if ( suffix ) {
						suffixes.push(suffix);
					}
				});

				if ( suffixes.length ) {
					repeaterGroups.push({ groupId: groupId, suffixes: suffixes });
				}
			});

			if ( repeaterGroups.length ) {
				values.__forminator_repeater_copies__ = repeaterGroups;
			}

			try {
				window.sessionStorage.setItem(this.getCheckoutFormStateStorageKey(), JSON.stringify(values));
			} catch ( error ) {
				// Ignore storage errors.
			}
		},

		// Restore saved field values when the user returns from Stripe Checkout.
		restoreCheckoutFormState: function() {
			var storedValues = null;

			try {
				storedValues = JSON.parse(window.sessionStorage.getItem(this.getCheckoutFormStateStorageKey()) || 'null');
			} catch ( error ) {
				storedValues = null;
			}

			if ( ! storedValues ) {
				return;
			}

			if ( storedValues.__forminator_repeater_copies__ ) {
				this.$el.trigger('forminator:restore-repeater-copies', [ storedValues.__forminator_repeater_copies__ ]);
				delete storedValues.__forminator_repeater_copies__;
			}

			Object.keys(storedValues).forEach(function(name) {
				var values = Array.isArray(storedValues[name]) ? storedValues[name] : [ storedValues[name] ];
				var escapedName = name.replace(/"/g, '\\"');
				var $fields = this.$el.find('[name="' + escapedName + '"]');

				if ( ! $fields.length ) {
					return;
				}

				var firstField = $fields.first();
				var tagName = ( firstField.prop('tagName') || '' ).toLowerCase();
				var type = ( firstField.attr('type') || '' ).toLowerCase();

				if ( 'hidden' === type ) {
					return;
				}

				if ( 'checkbox' === type || 'radio' === type ) {
					$fields.each(function() {
						var $field = $(this);
						$field.prop('checked', values.indexOf($field.val()) !== -1);
					});
					$fields.trigger('change', [ 'forminator_emulate_trigger' ]);
					return;
				}

				if ( 'select' === tagName && firstField.prop('multiple') ) {
					firstField.val(values).trigger('change', [ 'forminator_emulate_trigger' ]);
					return;
				}

				firstField.val(values[0]).trigger('change', [ 'forminator_emulate_trigger' ]);
			}, this);
		},

		// Clear the restored form values once the submission has completed.
		clearCheckoutFormState: function() {
			try {
				window.sessionStorage.removeItem(this.getCheckoutFormStateStorageKey());
			} catch ( error ) {
				// Ignore storage errors.
			}
		},

		// Ask server, whether the returned Checkout Session is still safe to reuse before resuming submission.
		validateRecoveredCheckoutSession: function() {
			var self = this;
			var formData = new FormData(this.$el[0]);
			var recoveryFormData = new FormData();
			var nonce = this.$el.find('[name="forminator_nonce"]').val() || '';
			var formId = this.$el.find('[name="form_id"]').val() || this.$el.data('form-id') || '';
			var paymentId = this._returnedCheckoutSessionId || '';

			if ( ! paymentId ) {
				return Promise.reject(new Error(window.ForminatorFront.cform.payment_failed));
			}

			// Include restored field values so conditional Stripe fields are evaluated in the same state used before redirect.
			formData.forEach(function(value, key) {
				if ( key !== 'action' && key !== 'paymentid' ) {
					recoveryFormData.append(key, value);
				}
			});
			recoveryFormData.append('action', 'forminator_check_stripe_checkout_session_status');
			recoveryFormData.append('forminator_nonce', nonce);
			recoveryFormData.append('form_id', formId);
			recoveryFormData.append('paymentid', paymentId);

			return new Promise(function(resolve, reject) {
				$.ajax({
					type: 'POST',
					url: window.ForminatorFront.ajaxUrl,
					data: recoveryFormData,
					cache: false,
					contentType: false,
					processData: false,
				}).done(function(response) {
					if ( response && response.success && response.data && response.data.recoverable ) {
						resolve(response.data);
						return;
					}

					reject(response && response.data ? response.data : null);
				}).fail(function(error) {
					reject(error);
				});
			});
		},

		// Reset the response UI before a new payment attempt, matching the standard submit flow state cleanup.
		resetResponseMessage: function() {
			var $target_message = this._form.find('.forminator-response-message');

			this._form.find('.forminator-error-message').not('.forminator-uploaded-files .forminator-error-message').remove();
			this._form.find('.forminator-field').removeClass('forminator-has_error');
			this._form.find('input, select, textarea').removeAttr('aria-invalid');

			$target_message
				.html('')
				.removeClass('forminator-loading forminator-error forminator-success forminator-show forminator-accessible')
				.removeAttr('tabindex')
				.attr('aria-hidden', true);
		},

		init: function () {
			if (!this.settings.paymentEl || typeof this.settings.paymentEl.data() === 'undefined') {
				return;
			}

			var self         = this;
			this._stripeData = this.settings.paymentEl.data();
			this._checkoutReturnError = this.getCheckoutReturnErrorMessage();
			this._returnedCheckoutSessionId = this._checkoutReturnError ? '' : this.getReturnedCheckoutSessionId();

			this._isCheckoutReturnFlow = this.isCheckoutSession() && !! this._returnedCheckoutSessionId && ! this._checkoutReturnError;
			this.clearCheckoutReturnQueryParams();

			// if ( false === this.mountStripeField() ) {
			// 	return;
			// }
			this._form = this.$el;

			if ( this._checkoutReturnError ) {
				this.clearPendingCheckoutSessionId();
			}

			if ( this.isCheckoutSession() ) {
				this.addCheckoutRequiredRule(this.getStripeData('checkoutEmail'));
				this.addCheckoutRequiredRule(this.getStripeData('checkoutPhone'));
				this.addCheckoutRequiredRule(this.getMappedBillingCountryFieldId());
			}

			if ( ! this.isCheckoutSession() && 0 < this.settings.stripe_depends.length ) {
				let selector = this.settings.stripe_depends.map(function(id) {
					return '[name="' + id + '"]';
				}).join(', ');

				// Lister fields' change to update Stripe plan
				this.$el.find(
					selector
				).each(function () {
					$( this ).on( 'change', function ( e, param1 ) {
						if ( self._isCheckoutReturnFlow ) {
							return;
						}

						if ( param1 !== 'forminator_emulate_trigger' ) {
							self.intent = true;
							self.updateAmount(e);
						}
					} );
				});
			}

			if ( this.isCheckoutSession() ) {
				this.bindCheckoutSessionFields();
				this.restoreCheckoutFormState();
				this._checkoutVisibilitySnapshot = this.getCheckoutVisibilitySnapshot();
			}

			if ( this._isCheckoutReturnFlow ) {
				this.validateRecoveredCheckoutSession().then(function(data) {
					var recoveredPaymentId = data && data.paymentid ? data.paymentid : self._returnedCheckoutSessionId;
					self.$el.find('#forminator-stripe-paymentid').val(recoveredPaymentId);
					self._stripeData['paymentid'] = recoveredPaymentId;

					window.setTimeout(function() {
						self.$el.trigger('forminator:stripe:return:ready');
					}, 0);
				}).catch(function(error) {
					var errorMessage = error && error.message ? error.message : window.ForminatorFront.cform.payment_failed;
					self._isCheckoutReturnFlow = false;
					self.intent = false;
					self.show_error(errorMessage);
					self.intent = true;
					// Show the error first, then rebuild Checkout so the user can retry without refreshing the page.
					self.resetCheckoutSession().finally(function() {
						self.unfrozeForm(self._form.find('.forminator-response-message'));
					});
				});
			} else {
				// update amount for the first time.
				this.updateAmount();
			}

			if ( this._checkoutReturnError ) {
				window.setTimeout(function() {
					self.show_error(self._checkoutReturnError);
				}, 0);
			}

			$(this.element).on('payment.before.submit.forminator', async (e, formData, callback) => {
				self.intent = false;
				self._beforeSubmitCallback = callback;
				self.resetResponseMessage();

				if ( self.isCheckoutSessionPreview() ) {
					// Preview submissions should continue through Forminator without Stripe confirmation.
					callback();
					return;
				}

				if ( self.isCheckoutSession() ) {
					var checkoutEmail = self.getStripeData('checkoutEmail');
					var $checkoutEmailField = checkoutEmail ? self.get_form_field(checkoutEmail) : $();
					var checkoutPhone = self.getStripeData('checkoutPhone');
					var $checkoutPhoneField = checkoutPhone ? self.get_form_field(checkoutPhone) : $();
					var checkoutBillingCountryFieldId = self.getMappedBillingCountryFieldId();
					var $checkoutBillingCountryField = checkoutBillingCountryFieldId ? self.get_form_field(checkoutBillingCountryFieldId) : $();
					var hasValidator = self.$el.data('validator');

					if ( ! self._isCheckoutReturnFlow ) {
						self.storeCheckoutFormState();

						try {
							await self.validateCheckoutSessionSubmission();
						} catch ( error ) {
							// updateAmount() already renders regular Forminator validation errors.
							// Only object-shaped Checkout/session failures should rebuild Stripe.
							var hasFormValidationErrors = error && $.isPlainObject(error) && typeof error.errors !== 'undefined' && error.errors.length;
							var hasCheckoutValidationError = error && $.isPlainObject(error) && ! hasFormValidationErrors;

							if ( hasCheckoutValidationError ) {
								// Rebuild Checkout immediately after stale-session validation fails so the
								// current submit cycle cannot keep running against the old Stripe state.
								await self.resetCheckoutSession(new Error(window.ForminatorFront.cform.checkout_session_invalid));
							}
							return;
						}
					}

					if ( hasValidator && $checkoutEmailField.length && typeof self.$el.validate === 'function' && ! self.$el.validate().element($checkoutEmailField) ) {
						self.unfrozeForm(self._form.find('.forminator-response-message'));
						return;
					}

					if ( hasValidator && $checkoutPhoneField.length && typeof self.$el.validate === 'function' && ! self.$el.validate().element($checkoutPhoneField) ) {
						self.unfrozeForm(self._form.find('.forminator-response-message'));
						return;
					}

					// Billing country lives on the mapped address subfield, so validate it whenever a billing address is being sent to Checkout.
					if ( hasValidator && $checkoutBillingCountryField.length && typeof self.$el.validate === 'function' && ! self.$el.validate().element($checkoutBillingCountryField) ) {
						self.unfrozeForm(self._form.find('.forminator-response-message'));
						return;
					}

					// Some forms may not have the jQuery validator attached, so keep a manual required check as a fallback.
					if ( ! hasValidator && checkoutBillingCountryFieldId && ! self.getMappedBillingCountryValue() ) {
						self.show_error(self.getStripeData('checkoutRequiredMessage') || 'This field is required to complete your payment.');
						return;
					}

					if (
						! hasValidator
						&& (
							( checkoutEmail && ! self.hasCheckoutContactElement() && ! self.getCheckoutEmailValue() )
							|| ( checkoutPhone && self.hasVisibleCheckoutPhoneField() && ! self.getCheckoutPhoneValue() )
						)
					) {
						callback();
						return;
					}

					if ( self._isCheckoutReturnFlow ) {
						self.verifyCheckoutSessionSubmission();
						return;
					}

					try {
						await self.syncCheckoutSessionBeforeConfirm();
					} catch ( error ) {
						return;
					}

					await self.confirmCheckoutSession();
					return;
				}

				const {error: submitError} = await this._elements.submit();
				if (submitError) {
					if ( 'undefined' !== typeof submitError.message ) {
						self.show_error(submitError.message);
					}
					return;
				}

				// If Blik payment method, create PaymentIntent and confirm on client side
				if ( self._stripeData['paymentMethodType'] === 'blik' ) {
					self.updateAmount();
				} else {

				self._stripe.createPaymentMethod( { elements: self._elements, params: { billing_details: this.billingDetails } } ).then(function (result) {
					if (result.error) {
						let resultError = result.error.message || window.ForminatorFront.cform.payment_failed;
						self.show_error(resultError);
						return;
					}
					var paymentMethod = self.getObjectValue(result, 'paymentMethod');

					self._stripeData['paymentMethod'] = self.getObjectValue(paymentMethod, 'id');
					self._stripeData['paymentMethodType'] = self.getObjectValue(paymentMethod, 'type');

					self.$el.find('#forminator-stripe-paymentmethod').val('');
					self.$el.find('#forminator-stripe-subscriptionid').val('');

					self.updateAmount();
				});
				}
			});

			this.$el.on("forminator:form:submit:stripe:3dsecurity", function(e, secret, subscription) {
				self.validate3d(e, secret, subscription);
			});

			this.$el.on("forminator:form:submit:stripe:redirect", this.paymentMethodRedirect.bind(this) );

			// Listen for fields change to update Billing Details
			this.$el.find(
				'input.forminator-input, select.forminator-select2'
			).each(function () {
				$( this ).on( 'change', function ( e, param1 ) {
					if ( param1 === 'forminator_emulate_trigger' ) {
						return true;
					}

					self.updateBillingDetails( e );
				} );
			});

			this.$el.on('forminator:form:submit:success', function() {
				if ( ! self.isCheckoutSession() ) {
					return;
				}

				self._isCheckoutReturnFlow = false;
				self.clearPendingCheckoutSessionId();
				self.clearCheckoutFormState();
			});

		},

		paymentMethodRedirect: function( e, redirectUrl, clientSecret, subscription ) {

			var self = this;
			self.$el.find('#forminator-stripe-subscriptionid').val( subscription );
			const stripePopup = window.open(
				redirectUrl,
				'PaymentMethodPopup',
				'width=800,height=600,scrollbars=yes'
			);
			// This function polls Stripe to check the status of the payment
			const interval = setInterval(async () => {
				const {error, paymentIntent} = await self._stripe.retrievePaymentIntent(clientSecret);

				if (error) {
					self.logStripeClientError('subscription_redirect_retrieve_payment_intent_error', error);
					clearInterval(interval);
					return;
				}

				if (paymentIntent.status === 'requires_capture' || paymentIntent.status === 'succeeded') {
					// Payment completed successfully!
					clearInterval(interval);
					stripePopup.close();
					if ( self._beforeSubmitCallback ) {
						self._beforeSubmitCallback.call();
					}
				} else if (paymentIntent.status === 'requires_payment_method' || paymentIntent.status === 'canceled') {
					let errorMessage = '';
					if ( paymentIntent.status === 'canceled' ) {
						errorMessage = window.ForminatorFront.cform.payment_cancelled;
					} else {
						errorMessage = window.ForminatorFront.cform.payment_failed;
					}
					self.logStripeClientError(
						'subscription_redirect_payment_intent_status_' + paymentIntent.status,
						{
							type: 'payment_intent_status',
							code: paymentIntent.status,
							message: errorMessage,
						}
					);
					clearInterval(interval);
					stripePopup.close();
					self.$el.find('#forminator-stripe-paymentmethod').val('');
					self.$el.find('#forminator-stripe-subscriptionid').val('');
					self.show_error(errorMessage);
				}
			}, 3000); // Poll every 3 seconds
		},

		// Stripe Checkout Session branch used by the new hosted checkout flow.
		isCheckoutSession: function() {
			return this.getStripeData('paymentApi') === 'checkout_session';
		},

		isCheckoutSessionPreview: function() {
			return this.isCheckoutSession() && this.settings.is_preview;
		},

		getPreviewData: function() {
			return this.settings.is_preview && this.settings.preview_data
				? JSON.stringify(this.settings.preview_data)
				: '';
		},

		// Build a comma-separated selector for Forminator fields and their child inputs.
		buildFieldSelector: function(fields) {
			fields = fields || [];

			fields = fields.filter(function(id, index) {
				return id && fields.indexOf(id) === index;
			});

			if ( ! fields.length ) {
				return '';
			}

			return fields.map(function(id) {
				return '[name="' + id + '"], [name="' + id + '[]"], [name^="' + id + '-"]';
			}).join(', ');
		},

		// Return fields watched by each Checkout Session update type.
		getCheckoutSessionFields: function(type) {
			var fields = {
				action: [
					this.getStripeData('checkoutEmail'),
					this.getStripeData('checkoutPhone'),
					this.getStripeData('billingName'),
					this.getStripeData('billingAddress'),
				],
				dependent: this.settings.stripe_depends || [],
				metadata: this.settings.stripe_checkout_metadata_depends || [],
			};

			return fields[type] || [];
		},

		getCheckoutSessionFieldsSnapshot: function(type) {
			var selector = this.buildFieldSelector(this.getCheckoutSessionFields(type));

			if ( ! selector ) {
				return '';
			}

			return JSON.stringify(this.$el.find(selector).serializeArray());
		},

		addCheckoutRequiredRule: function(fieldId) {
			if ( ! fieldId || typeof $.fn.rules !== 'function' || ! this.$el.data('validator') ) {
				return;
			}

			var $field = this.get_form_field(fieldId);

			if ( ! $field.length ) {
				return;
			}

			$field.rules('add', {
				required: true,
				messages: {
					required: this.getStripeData('checkoutRequiredMessage') || 'This field is required to complete your payment.',
				},
			});
		},

		getMappedBillingCountryFieldId: function() {
			if ( ! this.getStripeData('billing') || ! this.getStripeData('billingAddress') ) {
				return '';
			}

			return this.getStripeData('billingAddress') + '-country';
		},

		getMappedBillingCountryValue: function() {
			var billingCountryFieldId = this.getMappedBillingCountryFieldId();

			if ( ! billingCountryFieldId ) {
				return '';
			}

			var $countryField = this.get_form_field(billingCountryFieldId);

			if ( ! $countryField.length ) {
				return '';
			}

			return $countryField.find(':selected').data('country-code') || $countryField.val() || '';
		},

		// Read the Checkout email from the configured Checkout email field.
		getCheckoutEmailValue: function() {
			var checkoutEmail = this.getStripeData('checkoutEmail');

			if ( ! checkoutEmail ) {
				return '';
			}

			var $checkoutEmailField = this.get_form_field(checkoutEmail);

			return $checkoutEmailField.length && ! forminatorUtils().is_hidden( $checkoutEmailField )
				? this.get_field_value(checkoutEmail) || ''
				: '';
		},

		// Check whether Stripe's contact element should collect the Checkout email.
		hasCheckoutContactElement: function() {
			var checkoutEmail = this.getStripeData('checkoutEmail');
			var $checkoutEmailField = checkoutEmail ? this.get_form_field(checkoutEmail) : $();
			var hasVisibleCheckoutEmailField = $checkoutEmailField.length && ! forminatorUtils().is_hidden( $checkoutEmailField );
			var hasContactElement = this.isCheckoutSession() && ( ! checkoutEmail || ! hasVisibleCheckoutEmailField );

			return hasContactElement;
		},

		hasVisibleCheckoutPhoneField: function() {
			var checkoutPhone = this.getStripeData('checkoutPhone');
			var $checkoutPhoneField = checkoutPhone ? this.get_form_field(checkoutPhone) : $();

			return $checkoutPhoneField.length && ! forminatorUtils().is_hidden( $checkoutPhoneField );
		},

		hasCheckoutPhoneCollection: function() {
			return !! this.getStripeData('checkoutPhoneCollectionEnabled');
		},

		// Read the Checkout phone from the configured checkout phone field.
		getCheckoutPhoneValue: function() {
			if ( ! this.hasVisibleCheckoutPhoneField() ) {
				return '';
			}

			return this.get_field_value(this.getStripeData('checkoutPhone')) || '';
		},

		getCheckoutVisibilitySnapshot: function() {
			var checkoutEmail = this.getStripeData('checkoutEmail');
			var checkoutPhone = this.getStripeData('checkoutPhone');
			var $checkoutEmailField = checkoutEmail ? this.get_form_field(checkoutEmail) : $();
			var $checkoutPhoneField = checkoutPhone ? this.get_form_field(checkoutPhone) : $();

			return JSON.stringify({
				checkoutEmailVisible: $checkoutEmailField.length && ! forminatorUtils().is_hidden( $checkoutEmailField ),
				checkoutPhoneVisible: $checkoutPhoneField.length && ! forminatorUtils().is_hidden( $checkoutPhoneField ),
			});
		},

		// Validate a country code against Stripe's supported billing address countries.
		isStripeAllowedCountryCode: function(countryCode) {
			var allowedCountryCodes = 'AC AD AE AF AG AI AL AM AO AQ AR AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CD CF CG CH CI CK CL CM CN CO CR CV CW CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MK ML MM MN MO MQ MR MS MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SZ TA TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VN VU WF WS XK YE YT ZA ZM ZW ZZ';

			return ( ' ' + allowedCountryCodes + ' ' ).indexOf(' ' + countryCode + ' ') !== -1;
		},

		// Build Checkout billing details from mapped name and address fields.
		getCheckoutBillingAddressValue: function() {
			if ( ! this.getStripeData('billing') ) {
				return null;
			}

			var billingName = this.getStripeData('billingName');
			var billingAddress = this.getStripeData('billingAddress');
			var billingDetails = {};
			var nameField = billingName ? this.get_field_value(billingName) : '';

			if ( billingName && ! nameField ) {
				var fName = this.get_field_value(billingName + '-first-name') || '';
				var lName = this.get_field_value(billingName + '-last-name') || '';

				nameField = fName + ' ' + lName;
			}

			if ( nameField && ' ' !== nameField ) {
				billingDetails.name = nameField;
			}

			let address = {};
			if ( billingAddress ) {
				var addressLine1 = this.get_field_value(billingAddress + '-street_address') || '';
				if ( addressLine1 ) {
					address.line1 = addressLine1;
				}

				var addressLine2 = this.get_field_value(billingAddress + '-address_line') || '';
				if ( addressLine2 ) {
					address.line2 = addressLine2;
				}

				var addressCity = this.get_field_value(billingAddress + '-city') || '';
				if ( addressCity ) {
					address.city = addressCity;
				}

				var addressState = this.get_field_value(billingAddress + '-state') || '';
				if ( addressState ) {
					address.state = addressState;
				}

				var countryField = this.get_form_field(billingAddress + '-country');
				var addressCountry = countryField.find(':selected').data('country-code') || countryField.val();
				if ( addressCountry ) {
					addressCountry = String(addressCountry).toUpperCase();
					if ( this.isStripeAllowedCountryCode(addressCountry) ) {
						address.country = addressCountry;
					}
				}

				var addressZip = this.get_field_value(billingAddress + '-zip') || '';
				if ( addressZip ) {
					address.postal_code = addressZip;
				}
			}

			if ( Object.keys(address).length ) {
				billingDetails.address = address;
			}

			return Object.keys(billingDetails).length ? billingDetails : null;
		},

		// Safely call a Stripe Checkout action and silence rejected async updates.
		runCheckoutAction: function(action, value) {
			if ( ! this._checkoutActions || typeof this._checkoutActions[action] !== 'function' ) {
				return;
			}

			try {
				var result = this._checkoutActions[action](value);
				if ( result && typeof result.catch === 'function' ) {
					result.catch(function() {});
				}
			} catch ( error ) {
				return;
			}
		},

		// Push mapped customer details into the active Stripe Checkout Session.
		syncCheckoutCustomerDetails: function() {
			var checkoutPhone = this.getCheckoutPhoneValue();

			if ( ! this.hasCheckoutContactElement() ) {
				this.runCheckoutAction('updateEmail', this.getCheckoutEmailValue() || null);
			}

			if ( this.hasVisibleCheckoutPhoneField() && this.hasCheckoutPhoneCollection() ) {
				this.runCheckoutAction('updatePhoneNumber', checkoutPhone || null);
			}

			var billingAddress = this.getCheckoutBillingAddressValue();
			if ( billingAddress ) {
				this.runCheckoutAction('updateBillingAddress', billingAddress);
			}
		},

		// Bind all mapped fields that can update or refresh a Checkout Session.
		bindCheckoutSessionFields: function() {
			var self = this;
			var handlers = {
				action: function() {
					self.syncCheckoutCustomerDetails();
				},
				dependent: function() {
					self.refreshCheckoutSession().catch(function() {});
				},
			};

			Object.keys(handlers).forEach(function(type) {
				var selector = self.buildFieldSelector(self.getCheckoutSessionFields(type));

				if ( ! selector ) {
					return;
				}

				self.$el.find(selector).each(function() {
					$(this).on('change', function(e, param1) {
						if ( ! self.isCheckoutSession() || self.isCheckoutSessionPreview() || self._isCheckoutReturnFlow || param1 === 'forminator_emulate_trigger' ) {
							return;
						}

						if ( 'action' === type ) {
							handlers[type]();
							return;
						}

						window.clearTimeout(self._checkoutRefreshTimer);
						self._checkoutRefreshTimer = window.setTimeout(handlers[type], 300);
					});
				});
			});

			this.$el.on('forminator:field:condition:toggled', function() {
				var nextVisibilitySnapshot = self.getCheckoutVisibilitySnapshot();

				if (
					! self.isCheckoutSession()
					|| self.isCheckoutSessionPreview()
					|| self._isCheckoutReturnFlow
					|| self._checkoutVisibilitySnapshot === nextVisibilitySnapshot
				) {
					return;
				}

				self._checkoutVisibilitySnapshot = nextVisibilitySnapshot;

				window.clearTimeout(self._checkoutRefreshTimer);
				self._checkoutRefreshTimer = window.setTimeout(function() {
					self.refreshCheckoutSession().catch(function() {});
				}, 300);
			});
		},

		// Rebuild the Checkout Session before we try to confirm it.
		refreshCheckoutSession: function() {
			var self = this;
			var previousIntent = self.intent;
			var refreshRequestId = self.getNextCheckoutRefreshRequestId();
			var restoreIntent = function() {
				self.intent = previousIntent;
			};

			self.intent = true;
			return new Promise(function(resolve, reject) {
				self.updateAmount(null, {
					checkoutRefreshRequestId: refreshRequestId,
					onSuccess: function() {
						if ( ! self.isLatestCheckoutRefreshRequest(refreshRequestId) ) {
							restoreIntent();
							resolve();
							return;
						}

						self.waitForCheckoutReady().then(function() {
							self._checkoutDependentSnapshot = self.getCheckoutSessionFieldsSnapshot('dependent');
							self._checkoutVisibilitySnapshot = self.getCheckoutVisibilitySnapshot();
							restoreIntent();
							resolve();
						}).catch(function(error) {
							restoreIntent();
							reject(error);
						});
					},
					onFailure: function(error) {
						if ( ! self.isLatestCheckoutRefreshRequest(refreshRequestId) ) {
							restoreIntent();
							resolve();
							return;
						}

						restoreIntent();
						reject(error || new Error(window.ForminatorFront.cform.payment_failed));
					},
				});
			});
		},

		isLatestCheckoutRefreshRequest: function(refreshRequestId) {
			return ! refreshRequestId || refreshRequestId === this._checkoutRefreshRequestId;
		},

		getNextCheckoutRefreshRequestId: function() {
			return ++this._checkoutRefreshRequestId;
		},

		showCheckoutSessionRefreshError: function(error) {
			var wasIntent = this.intent;

			this.intent = false;
			this.show_error(this.getStripeCheckoutErrorMessage(error));
			this.intent = wasIntent;
		},

		// Wait until the Checkout UI has finished mounting.
		waitForCheckoutReady: function() {
			if ( this._checkoutActions ) {
				return Promise.resolve();
			}

			if ( this._mountPromise && typeof this._mountPromise.then === 'function' ) {
				return this._mountPromise;
			}

			return Promise.reject(new Error(window.ForminatorFront.cform.payment_failed));
		},

		// Give the Checkout UI a short window to become confirmable.
		waitForCheckoutCanConfirm: function(timeoutMs = 1500) {
			var self = this;

			if ( this._checkoutCanConfirm ) {
				return Promise.resolve();
			}

			return new Promise(function(resolve) {
				var start = Date.now();

				var poll = function() {
					if ( self._checkoutCanConfirm || ( Date.now() - start ) >= timeoutMs ) {
						resolve();
						return;
					}

					window.setTimeout(poll, 50);
				};

				poll();
			});
		},

		// Sync mount state and readiness before confirming Checkout.
		syncCheckoutSessionBeforeConfirm: function() {
			var self = this;

			if ( self._checkoutSyncPromise ) {
				return self._checkoutSyncPromise;
			}

			self._checkoutSyncPromise = new Promise(function(resolve, reject) {
				var finalize = function() {
					self.waitForCheckoutReady()
						.then(function() {
							return self.waitForCheckoutCanConfirm();
						})
						.then(function() {
							self._checkoutSyncPromise = null;
							resolve();
						})
						.catch(function(error) {
							self._checkoutSyncPromise = null;
							self.show_error(self.getStripeCheckoutErrorMessage(error));
							reject(error);
						});
				};
				var refreshAndFinalize = function() {
					self.refreshCheckoutSession().then(finalize).catch(function(error) {
						self.showCheckoutSessionRefreshError(error);
						self._checkoutSyncPromise = null;
						reject(error);
					});
				};
				var refreshAndStop = function(error) {
					self.refreshCheckoutSession().then(function() {
						self.show_error(self.getStripeCheckoutErrorMessage(error));
						self._checkoutSyncPromise = null;
						reject(error);
					}).catch(function(refreshError) {
						self.showCheckoutSessionRefreshError(refreshError);
						self._checkoutSyncPromise = null;
						reject(refreshError);
					});
				};

				if ( self.getStripeData('forceMountStripeField') ) {
					// Forced-mount sessions only exist to keep Checkout rendered, so rebuild first and stop this submit.
					var invalidSessionError = new Error(window.ForminatorFront.cform.checkout_session_invalid);
					refreshAndStop(invalidSessionError);
					return;
				}

				if ( ! self._checkoutActions ) {
					refreshAndFinalize();
					return;
				}

				if (
					self._checkoutDependentSnapshot !== self.getCheckoutSessionFieldsSnapshot('dependent')
					|| self._checkoutVisibilitySnapshot !== self.getCheckoutVisibilitySnapshot()
				) {
					refreshAndFinalize();
					return;
				}

				finalize();
			});

			return self._checkoutSyncPromise;
		},

		getSafeStripeLogDetails: function(context, error) {
			var formId = this.$el.find('[name="form_id"]').val() || this.$el.data('form-id') || '';

			return {
				formId,
				context: context || '',
				errorName: error && error.name ? error.name : '',
				errorType: error && error.type ? error.type : '',
				errorCode: error && error.code ? error.code : '',
				errorMessage: error && error.message ? error.message : '',
				hasMessage: !! ( error && error.message ),
			};
		},

		logStripeClientError: function(context, error) {
			if ( window.console && 'function' === typeof window.console.warn ) {
				window.console.warn(
					'[Forminator][Stripe]',
					this.getSafeStripeLogDetails(context, error)
				);
			}
		},

		// Run Forminator server-side validation before redirecting to hosted Checkout.
		validateCheckoutSessionSubmission: function() {
			var self = this;

			return new Promise(function(resolve, reject) {
				self.updateAmount(null, {
					validateOnly: true,
					onSuccess: resolve,
					onFailure: function(error) {
						reject(error || new Error(window.ForminatorFront.cform.error));
					},
				});
			});
		},

		// A failed or pending Checkout confirmation can leave an old Session ID in the form; clear it before creating a fresh Session.
		resetCheckoutSession: async function(errorToShowOnSuccess = null) {
			var self = this;

			this.clearRecoveredCheckoutSessionState();
			return this.refreshCheckoutSession().then(function() {
				if ( errorToShowOnSuccess ) {
					self.show_error(self.getStripeCheckoutErrorMessage(errorToShowOnSuccess));
				}
			}).catch(function(error) {
				// When refresh fails after a known validation error, keep that original error visible.
				self.show_error(errorToShowOnSuccess ? self.getStripeCheckoutErrorMessage(errorToShowOnSuccess) : window.ForminatorFront.cform.payment_session_refresh_failed);
			});
		},

		// Confirm the hosted Checkout Session and continue form submission.
		confirmCheckoutSession: async function() {
			if ( ! this._checkoutActions ) {
				this.logStripeClientError(
					'checkout_confirm_missing_actions',
					new Error('Missing checkout actions before confirm.')
				);
				this.show_error(window.ForminatorFront.cform.payment_failed);
				return;
			}

			let confirmOptions = {
				redirect: 'if_required',
			};
			let checkoutEmail = this.getCheckoutEmailValue();
			if ( checkoutEmail && ! this.hasCheckoutContactElement() ) {
				confirmOptions.email = checkoutEmail;
			}
			let checkoutPhone = this.getCheckoutPhoneValue();
			if ( checkoutPhone && this.hasCheckoutPhoneCollection() ) {
				confirmOptions.phoneNumber = checkoutPhone;
			}
			let checkoutBillingAddress = this.getCheckoutBillingAddressValue();
			if ( checkoutBillingAddress ) {
				confirmOptions.billingAddress = checkoutBillingAddress;
			}
			try {
				let paymentId = this.getStripeData('paymentid') || '';
				this.storeCheckoutFormState();
				this.storePendingCheckoutSessionId(paymentId);
				this.storeCheckoutReturnState(paymentId);
				const result = await this._checkoutActions.confirm(confirmOptions);

				if ( result && result.type === 'error' ) {
					this.logStripeClientError('checkout_confirm_result_error', result.error || result);
					this.clearPendingCheckoutSessionId();
					this.show_error(this.getStripeCheckoutErrorMessage(result.error));
					return;
				}

				this.verifyCheckoutSessionSubmission();
			} catch ( error ) {
				this.logStripeClientError('checkout_confirm_exception', error);
				this.clearPendingCheckoutSessionId();
				this.show_error(this.getStripeCheckoutErrorMessage(error));
			}
		},

		// Re-check the returned Checkout Session until Stripe reports it as ready.
		verifyCheckoutSessionSubmission: function(attempt = 0) {
			var self = this;

			self.updateAmount(null, {
				onSuccess: function() {},
				onFailure: async function() {
					self.clearPendingCheckoutSessionId();
					// Server validation failed while checking the returned session, so rebuild Checkout before another attempt.
					await self.resetCheckoutSession();
				},
			});
		},

		validate3d: function( e, secret, subscription ) {
			var self = this;

			if ( subscription ) {
				this._stripe.confirmPayment({
					clientSecret: secret,
					elements: self._elements,
					redirect: 'if_required',
					confirmParams: {
						return_url: this.getStripeData('returnUrl'),
					},
				})
				.then(function(result) {
					if ( result && result.error ) {
						self.logStripeClientError('subscription_confirm_payment_error', result.error);
					}

					self.$el.find('#forminator-stripe-subscriptionid').val( subscription );

					if (self._beforeSubmitCallback) {
						self._beforeSubmitCallback.call();
					}
				})
				.catch(function(error) {
					self.logStripeClientError('subscription_confirm_payment_exception', error);
					self.$el.find('#forminator-stripe-subscriptionid').val('');
					self.show_error(error && error.message ? error.message : window.ForminatorFront.cform.payment_failed);
				});
			} else {
				this._stripe.retrievePaymentIntent(
					secret
				).then(function(result) {
					if ( ['requires_action', 'requires_confirmation', 'requires_source_action'].includes( result.paymentIntent.status )
						||  self.getStripeData('paymentMethodType') === 'blik'
					) {
						self._stripe
							.confirmPayment({
								clientSecret: secret,
								elements: self._elements,
								redirect: 'if_required',
							} )
							.then( function ( result ) {
								if ( result.error ) {
									self.logStripeClientError('3ds_confirm_payment_error', result.error);
									self.$el.find('#forminator-stripe-subscriptionid').val('');
									self.show_error(result.error.message);
								} else if ( self._beforeSubmitCallback ) {
									self._beforeSubmitCallback.call();
								}
							} )
							.catch( function ( error ) {
								self.logStripeClientError('3ds_confirm_payment_exception', error);
								self.$el.find('#forminator-stripe-subscriptionid').val('');
								self.show_error(error && error.message ? error.message : window.ForminatorFront.cform.payment_failed);
							} );
					}
				});
			}
		},

		getForm: function(e) {
			var $form = $( e.target );

			if(!$form.hasClass('forminator-custom-form')) {
				$form = $form.closest('form.forminator-custom-form');
			}

			return $form;
		},

		updateAmount: function(e, options = {}) {
			if ( e && typeof e.preventDefault === 'function' ) {
				e.preventDefault();
			}
			var formData = new FormData( this.$el[0] );
			var self = this;
			var updateFormData = new FormData();

			// Every Checkout update can create or remount a Session, including the first page load.
			if ( this.isCheckoutSession() && ! options.checkoutRefreshRequestId ) {
				options.checkoutRefreshRequestId = this.getNextCheckoutRefreshRequestId();
			}

			// Remove action from formData.
			formData.forEach(function (value, key) {
				if (key !== 'action') {
					updateFormData.append(key, value);
				}
			});

			//Method set() doesn't work in IE11
			updateFormData.append( 'action', 'forminator_update_payment_amount' );
			updateFormData.append( 'paymentPlan', this.getStripeData('paymentPlan') );
			updateFormData.append( 'payment_method', this.getStripeData('paymentMethod') );
			updateFormData.append( 'payment_method_type', this.getStripeData('paymentMethodType') );
			updateFormData.append( 'payment_api', this.getStripeData('paymentApi') || '' );
			updateFormData.append( 'paymentid', this.isCheckoutSession() ? this.getStripeData('paymentid') || '' : '' );
			var previewData = this.getPreviewData();
			if ( this.isCheckoutSession() && previewData ) {
				updateFormData.append( 'is_preview', 1 );
				updateFormData.append( 'preview_data', previewData );
			} else if( previewData ) {
				// Mount Stripe field if it still isn't mounted.
				if ( ! self._paymentElement && ! self._lastMountFailed ) {
					self.mountStripeField();
					return;
				}
			}
			if ( this.intent ) {
				updateFormData.append( 'stripe-intent', true );
				updateFormData.append( 'stripe_first_payment_intent', ! this._paymentElement ? 1 : 0 );
			}
			if ( options.validateOnly ) {
				updateFormData.append( 'stripe_validate_submission', true );
			}
			var receipt = this.getStripeData('receipt');
			var receiptEmail = this.getStripeData('receiptEmail');

			if ( ! this.isCheckoutSession() && receipt && receiptEmail ) {
				var emailValue = this.get_field_value(receiptEmail) || '';

				updateFormData.append( 'receipt_email', emailValue );
			}
			var $target_message = this._form.find('.forminator-response-message');

			return $.ajax({
				type: 'POST',
				url: window.ForminatorFront.ajaxUrl,
				data: updateFormData,
				cache: false,
				contentType: false,
				processData: false,
				beforeSend: function () {
					if( typeof self.settings.has_loader !== "undefined" && self.settings.has_loader ) {
						if ( ! self.intent && !( self.isCheckoutSession() && options.validateOnly ) ) {
							$target_message.html('<p>' + self.settings.loader_label + '</p>');

							self.focus_to_element($target_message);

							$target_message.removeAttr("aria-hidden")
								.prop("tabindex", "-1")
								.removeClass('forminator-success forminator-error')
								.addClass('forminator-loading forminator-show')
							;
						}
					}

					self._form.find('button').attr('disabled', true);
				},
				success: function (data) {
						if (
							self.isCheckoutSession()
							&& options.checkoutRefreshRequestId
							&& ! self.isLatestCheckoutRefreshRequest(options.checkoutRefreshRequestId)
						) {
							if ( typeof options.onSuccess === 'function' ) {
								options.onSuccess(data);
							}
							return;
						}

						self._lastMountFailed = false;
						if (data.success === true) {
							if ( self.isCheckoutSession() && options.validateOnly ) {
								if ( typeof options.onSuccess === 'function' ) {
									options.onSuccess(data);
								}
							return;
							}

						// Store payment id
						if (typeof data.data !== 'undefined') {
							let hasPaymentId = 'undefined' !== typeof data.data.paymentid;
							let hasPaymentPlan = 'undefined' !== typeof data.data.paymentPlan;
							let hasCheckoutPhoneCollectionEnabled = 'undefined' !== typeof data.data.checkoutPhoneCollectionEnabled;
							let hasForceMountStripeField = 'undefined' !== typeof data.data.forceMountStripeField;
							let previousPaymentId = self.getStripeData('paymentid') || '';
							let previousSecret = self.getStripeData('secret') || '';
							// Detect whether the pricing context is unchanged so we can avoid unnecessary Checkout remounts.
							let sameCheckoutPaymentPlan = self.isCheckoutSession() &&
								self.intent &&
								hasPaymentPlan &&
								( self.getStripeData('paymentPlan') || '' ) === data.data.paymentPlan;
							// Detect when Stripe returned a brand new Checkout Session/client secret even if the plan hash stayed the same.
							let checkoutSessionChanged = self.isCheckoutSession() &&
								hasPaymentId &&
								(
									previousPaymentId !== data.data.paymentid
									|| previousSecret !== data.data.paymentsecret
								);

							// Save the latest Stripe ids before the early return check.
							self._stripeData['forceMountStripeField'] = hasForceMountStripeField ? !! data.data.forceMountStripeField : false;
							if ( hasCheckoutPhoneCollectionEnabled ) {
								self._stripeData['checkoutPhoneCollectionEnabled'] = !! data.data.checkoutPhoneCollectionEnabled;
							}

							if ( hasPaymentId ) {
								self.$el.find('#forminator-stripe-paymentid').val(data.data.paymentid);
								self._stripeData['paymentid'] = data.data.paymentid;
								if ( typeof data.data.paymentsecret !== 'undefined' ) {
									self._stripeData['secret'] = data.data.paymentsecret;
								}
							}

							if ( sameCheckoutPaymentPlan && ! checkoutSessionChanged ) {
								self.unfrozeForm($target_message);
								if ( typeof options.onSuccess === 'function' ) {
									options.onSuccess(data);
								}
								return;
							}

							if (hasPaymentId) {
								self.$el.find('#forminator-stripe-paymentmethod').val(self._stripeData['paymentMethod']);

								if (
									self.intent &&
									(
										! self.isCheckoutSession()
										|| ! self._paymentElement
										|| previousPaymentId !== data.data.paymentid
										|| previousSecret !== data.data.paymentsecret
									)
								) {
									self.mountStripeField(data.data.paymentsecret, data.data.amount);
								}

							}
							if (data.data.paymentmethod_failed) {
								self.$el.find('#forminator-stripe-paymentmethod').val('');
							}

							if (hasPaymentPlan) {
								self._stripeData['paymentPlan'] = data.data.paymentPlan;
							}
							if ( self.isCheckoutSession() ) {
								self._checkoutDependentSnapshot = self.getCheckoutSessionFieldsSnapshot('dependent');
							}
							if (!self.intent){
								self.handlePayment();
							} else {
								self.unfrozeForm($target_message);
							}
							if ( typeof options.onSuccess === 'function' ) {
								options.onSuccess(data);
							}

						} else {
							self.show_error('Invalid Payment Intent ID');
						}
					} else if ( ! self.intent ) {
						// Not success for payment.
						self.show_error(typeof data.data.message !== 'undefined' ? data.data.message : data.data);
						if ( typeof options.onFailure === 'function' ) {
							options.onFailure(data.data);
						}

						if(typeof data.data.errors !== 'undefined' && data.data.errors.length) {
							self.show_messages(data.data.errors);
						}

						var $captcha_field = self._form.find('.forminator-g-recaptcha');

						if ($captcha_field.length) {
							$captcha_field = $($captcha_field.get(0));

							var recaptcha_widget = $captcha_field.data('forminator-recapchta-widget'),
								recaptcha_size = $captcha_field.data('size');

							if (recaptcha_size === 'invisible') {
								window.grecaptcha.reset(recaptcha_widget);
							}
						}
					} else {
						// Not success for intent.
						if ( $.isPlainObject(data.data) && typeof data.data.paymentPlan !== 'undefined' ) {
							self._stripeData['paymentPlan'] = data.data.paymentPlan;
						}

						if ( ! self.isCheckoutSession() ) {
							self.unfrozeForm($target_message);
							return;
						}

						var error_message = data.data && typeof data.data.message !== 'undefined' ? data.data.message : data.data;
						if ( error_message ) {
							self.show_error(error_message);
							if ( typeof options.onFailure === 'function' ) {
								options.onFailure(data.data);
							}
							return;
						}
						self.unfrozeForm($target_message);
					}
				},
				error: function (err) {
					if (
						self.isCheckoutSession()
						&& options.checkoutRefreshRequestId
						&& ! self.isLatestCheckoutRefreshRequest(options.checkoutRefreshRequestId)
					) {
						if ( typeof options.onSuccess === 'function' ) {
							options.onSuccess(err);
						}
						return;
					}

					self._lastMountFailed = true;
					var $message = err.status === 400 ? window.ForminatorFront.cform.upload_error : window.ForminatorFront.cform.error;

					self.show_error($message);
					if ( typeof options.onFailure === 'function' ) {
						options.onFailure(err);
					}
				},
			}).always(
				function () {
					if ( !self.intent ) {
						self.$el.find('#forminator-stripe-paymentmethod').val('');
					}

					// Mount Stripe field if it still isn't mounted.
					if ( ! self.isCheckoutSession() && ! self._paymentElement && ! self._lastMountFailed ) {
						self.mountStripeField();
					}
				})
			},

		show_error: function(message) {
			var $target_message = this._form.find('.forminator-response-message');
			var wasSubmitIntent = ! this.intent;

			$target_message.empty().append($('<p></p>').text(message));
			this.unfrozeForm($target_message);

			if ( wasSubmitIntent ) {
				// Stop a failed submit from being resumed by a later plan/field refresh.
				this._beforeSubmitCallback = null;
				this.intent = true;
			}
		},

		unfrozeForm: function($target_message) {
			this._form.find('button').removeAttr('disabled');

			// Show preview errors, but do not show an empty error box.
			if ( ( ! this.intent || this.isCheckoutSessionPreview() ) && $.trim( $target_message.text() ) ) {
				$target_message.removeAttr("aria-hidden")
					.prop("tabindex", "-1")
					.removeClass('forminator-loading forminator-accessible')
					.addClass('forminator-error forminator-show');
				this.focus_to_element($target_message);

			}

			this.enable_form();
		},

		enable_form: function() {
			if( typeof this.settings.has_loader !== "undefined" && this.settings.has_loader ) {
				var $target_message = this._form.find('.forminator-response-message');

				// Enable form fields
				this._form.removeClass('forminator-fields-disabled');

				$target_message.removeClass('forminator-loading');
			}
		},

		focus_to_element: function ($element) {
			// force show in case its hidden of fadeOut
			$element.show();
			$('html,body').animate({scrollTop: ($element.offset().top - ($(window).height() - $element.outerHeight(true)) / 2)}, 500, function () {
				if (!$element.attr("tabindex")) {
					$element.attr("tabindex", -1);
				}

				$element.focus();
			});
		},

		show_messages: function (errors) {
			var self = this,
				forminatorFrontCondition = self.$el.data('forminatorFrontCondition');
			if (typeof forminatorFrontCondition !== 'undefined') {
				// clear all validation message before show new one
				this.$el.find('.forminator-error-message').remove();
				var i = 0;
				errors.forEach(function (value) {
					var element_id = Object.keys(value),
						message = Object.values(value),
						element = forminatorFrontCondition.get_form_field(element_id);
					if (element.length) {
						if (i === 0) {
							// focus on first error
							self.$el.trigger('forminator.front.pagination.focus.input',[element]);
							self.focus_to_element(element);
						}

						if ($(element).hasClass('forminator-input-time')) {
							var $time_field_holder = $(element).closest('.forminator-field:not(.forminator-field--inner)'),
								$time_error_holder = $time_field_holder.children('.forminator-error-message');

							if ($time_error_holder.length === 0) {
								$time_field_holder.append('<span class="forminator-error-message" aria-hidden="true"></span>');
								$time_error_holder = $time_field_holder.children('.forminator-error-message');
							}
							$time_error_holder.html(message);
						}

						var $field_holder = $(element).closest('.forminator-field--inner');

						if ($field_holder.length === 0) {
							$field_holder = $(element).closest('.forminator-field');
							if ($field_holder.length === 0) {
								// handling postdata field
								$field_holder = $(element).find('.forminator-field');
								if ($field_holder.length > 1) {
									$field_holder = $field_holder.first();
								}
							}
						}

						var $error_holder = $field_holder.find('.forminator-error-message');

						if ($error_holder.length === 0) {
							$field_holder.append('<span class="forminator-error-message" aria-hidden="true"></span>');
							$error_holder = $field_holder.find('.forminator-error-message');
						}
						$(element).attr('aria-invalid', 'true');
						$error_holder.html(message);
						$field_holder.addClass('forminator-has_error');
						i++;
					}
				});
			}

			return this;
		},

		isRelevantField: function( e, billingName, billingEmail, billingPhone, billingAddress ) {
			if ( ! e ) {
				return true;
			}
			const fieldName = $(e.target).attr('name');
			if ( ! billingName ) {
				return false;
			}

			return billingEmail && fieldName === billingEmail
				|| billingPhone && fieldName === billingPhone
				|| billingName && ( fieldName === billingName || fieldName.startsWith( billingName + '-' ) )
				|| billingAddress && ( fieldName === billingAddress || fieldName.startsWith( billingAddress + '-' ) );
		},

		updateBillingDetails: function (e) {
			if ( this.isCheckoutSession() ) {
				return true;
			}

			var billing = this.getStripeData('billing');
			var billingName = this.getStripeData('billingName');
			var billingEmail = this.getStripeData('billingEmail');
			var billingPhone = this.getStripeData('billingPhone');
			var billingAddress = this.getStripeData('billingAddress');

			// If billing is disabled, return
			if (!billing || !this._paymentElement) {
				return true;
			}

			var billingDetails = {};

			if( ! this.isRelevantField( e, billingName, billingEmail, billingPhone, billingAddress ) ) {
				return true;
			}
			var nameField = this.get_field_value(billingName);

			// Check if Name field is multiple
			if (!nameField) {
				var fName = this.get_field_value(billingName + '-first-name') || '';
				var lName = this.get_field_value(billingName + '-last-name') || '';

				nameField = fName + ' ' + lName;
			}

			// Check if Name field is empty in the end, if not assign to the object
			if (' ' !== nameField) {
				billingDetails.name = nameField;
			}

			// Map email field
			var billingEmailValue = this.get_field_value(billingEmail) || '';
			if (billingEmailValue) {
				billingDetails.email = billingEmailValue;
			}

			// Map phone field
			var billingPhoneValue = this.get_field_value(billingPhone) || '';
			if (billingPhoneValue) {
				billingDetails.phone = billingPhoneValue;
			}

			let address = {};
			// Map address line 1 field
			var addressLine1 = this.get_field_value(billingAddress + '-street_address') || '';
			if (addressLine1) {
				address.line1 = addressLine1;
			}

			// Map address line 2 field
			var addressLine2 = this.get_field_value(billingAddress + '-address_line') || '';
			if (addressLine2) {
				address.line2 = addressLine2;
			}

			// Map address city field
			var addressCity = this.get_field_value(billingAddress + '-city') || '';
			if (addressCity) {
				address.city = addressCity;
			}

			// Map address state field
			var addressState = this.get_field_value(billingAddress + '-state') || '';
			if (addressState) {
				address.state = addressState;
			}

			// Map address country field
			var countryField = this.get_form_field(billingAddress + '-country');
			var addressCountry = countryField.find(':selected').data('country-code');

			if (addressCountry) {
				address.country = addressCountry;
			}

			// Map address country field
			var addressZip = this.get_field_value(billingAddress + '-zip') || '';
			if (addressZip) {
				address.postal_code = addressZip;
			}

			if ( Object.keys(address).length ) {
				billingDetails.address = address;
			}

			if ( Object.keys(billingDetails).length ) {
				this.billingDetails = billingDetails;
				this._paymentElement.update({
					defaultValues: {
						billingDetails,
					}
				});
			}
		},

		handlePayment: function () {
			var self = this,
				input = $( '.forminator-number--field, .forminator-currency, .forminator-calculation' );

			if ( input.inputmask ) {
				input.inputmask('remove');
			}

			if (self._beforeSubmitCallback) {
				self._beforeSubmitCallback.call();
			}
		},

		sanitizePaymentOptions: function( paymentOptions ) {
			let sanitizedPaymentOptions = { ...paymentOptions };
			let fields = { ...( sanitizedPaymentOptions.fields || {} ) };
			let billingDetailsFields = { ...( fields.billingDetails || {} ) };
			fields.billingDetails = billingDetailsFields;
			sanitizedPaymentOptions.fields = fields;

			if ( sanitizedPaymentOptions.layout && sanitizedPaymentOptions.layout.type === 'accordion' ) {
				if ( sanitizedPaymentOptions.layout.radios === true ) {
					sanitizedPaymentOptions.layout.radios = 'always';
				} else if ( sanitizedPaymentOptions.layout.radios === false || sanitizedPaymentOptions.layout.radios === undefined ) {
					sanitizedPaymentOptions.layout.radios = 'never';
				}
			}

			if ( sanitizedPaymentOptions.layout && sanitizedPaymentOptions.layout.defaultCollapsed !== undefined ) {
				delete sanitizedPaymentOptions.layout.defaultCollapsed;
			}

			if ( window.location.protocol !== 'https:' ) {
				sanitizedPaymentOptions.wallets = {
					applePay: 'never',
					googlePay: 'never',
				};
			}

			return sanitizedPaymentOptions;
		},

		sanitizeCheckoutPaymentOptions: function( paymentOptions ) {
			let sanitizedPaymentOptions = this.sanitizePaymentOptions( paymentOptions );
			let billingDetailsFields = sanitizedPaymentOptions.fields.billingDetails;

			if ( ! this.hasCheckoutContactElement() && this.getStripeData('checkoutEmail') ) {
				billingDetailsFields.email = 'never';
			}

			if ( this.getStripeData('billing') && this.getStripeData('billingName') && this.getStripeData('billingAddress') ) {
				billingDetailsFields.name = 'never';
			}

			if ( this.hasVisibleCheckoutPhoneField() && this.hasCheckoutPhoneCollection() ) {
				billingDetailsFields.phone = 'never';
			}

			if (  this.getStripeData('billing') && this.getStripeData('billingAddress') ) {
				billingDetailsFields.address = 'never';
			}

			return sanitizedPaymentOptions;
		},

		mountStripeField: function ( clientSecret = null, amount = null ) {
			let isSubscription = 'subscription' === clientSecret;
			let fieldId = this.getStripeData('fieldId'),
				key = this.getStripeData('key'),
				paymentOptions = { ...this.getStripeData('paymentOptions') }
			;
			let checkoutMountRequestId = this.isCheckoutSession() ? ++this._checkoutMountRequestId : 0;

			if ( isSubscription ) {
				clientSecret = null;
			}

			if ( this._paymentElement ) {
				this._paymentElement.unmount();
			}
			if ( this._contactElement && typeof this._contactElement.unmount === 'function' ) {
				this._contactElement.unmount();
			}
			if ( this._currencySelectorElement && typeof this._currencySelectorElement.unmount === 'function' ) {
				this._currencySelectorElement.unmount();
			}
			this._elements = null;
			this._paymentElement = null;
			this._contactElement = null;
			this._currencySelectorElement = null;
			this._checkout = null;
			this._checkoutActions = null;
			this._checkoutCanConfirm = false;
			this._mountPromise = null;

			if ( null === key ) {
				return false;
			}

			// Server-side flag gates the Checkout Sessions developer widget (auto-injected in test mode).
			var stripeOptions = {};
			if ( this.isCheckoutSession() ) {
				stripeOptions.developerTools = {
					assistant: { enabled: !! this.getStripeData( 'showStripeDeveloperWidget' ) },
				};
			}

			// Init Stripe.
			this._stripe = Stripe( key, stripeOptions );

			if ( this.isCheckoutSession() ) {
				// Checkout Sessions require a server-generated session client secret.
				return this.mountCheckoutSessionField(clientSecret, fieldId, paymentOptions, checkoutMountRequestId);
			}

			let stripeObject = { ...this.getStripeData('elementsOptions') };
			if ( clientSecret ) {
				// unset paymentMethodTypes because we can't set it without mode attribute.
				delete stripeObject.paymentMethodTypes;
				stripeObject.clientSecret = clientSecret;
			} else if ( isSubscription && amount ) {
				stripeObject.mode = 'subscription';
				stripeObject.amount = amount;
				stripeObject.currency = this.getStripeData('currency') || 'usd';
			} else {
				stripeObject.mode = 'setup';
				stripeObject.currency = this.getStripeData('currency') || 'usd';
			}

			this._elements = this._stripe.elements(stripeObject);

			paymentOptions = this.sanitizePaymentOptions( paymentOptions );
			this._paymentElement = this._elements.create('payment', paymentOptions );

			let paymentElement = document.getElementById('payment-element-' + fieldId);
			if( ! paymentElement ) {
				// In case if the element is not found, we can't mount it, so we stop the process to avoid errors in console.
				return false;
			}
			this._paymentElement.mount('#payment-element-' + fieldId);

			var self = this;
			this._paymentElement.on('ready', function() {
				self.updateBillingDetails();
			});
			this._paymentElement.on('change', function(event) {
				let isBlik = event.value.type === 'blik';
				self._stripeData['paymentMethodType'] = isBlik ? 'blik' : '';
			});
		},

		mountCheckoutSessionField: function(clientSecret, fieldId, paymentOptions, checkoutMountRequestId) {
			if ( ! clientSecret ) {
				return false;
			}

			let paymentElement = document.getElementById('payment-element-' + fieldId);
			if ( ! paymentElement ) {
				return false;
			}
			let contactElement = document.getElementById('payment-contact-element-' + fieldId);
			let currencySelectorElement = document.getElementById('payment-currency-selector-element-' + fieldId);
			let stripeObject = {
				clientSecret: clientSecret,
			};

			if ( this.getStripeData('adaptivePricing') ) {
				stripeObject.adaptivePricing = {
					allowed: true,
				};
			}
			let checkoutElementsOptions = { ...this.getStripeData('checkoutElementsOptions') };

			if ( Object.keys(checkoutElementsOptions).length ) {
				stripeObject.elementsOptions = checkoutElementsOptions;
			}
			let sanitizedPaymentOptions = this.sanitizeCheckoutPaymentOptions( paymentOptions );
			let checkoutInitializer = null;
			if ( typeof this._stripe.initCheckoutElementsSdk === 'function' ) {
				// Use the current Checkout Elements SDK initializer when it is available.
				checkoutInitializer = this._stripe.initCheckoutElementsSdk.bind(this._stripe);
			} else if ( typeof this._stripe.initCheckout === 'function' ) {
				// Fall back to the legacy Checkout initializer for Stripe.js versions that expose initCheckout.
				checkoutInitializer = this._stripe.initCheckout.bind(this._stripe);
			}

			if ( ! checkoutInitializer ) {
				this.show_error(window.ForminatorFront.cform.payment_failed);
				if ( window.console && typeof window.console.error === 'function' ) {
					window.console.error('Stripe Checkout SDK is not available on the loaded Stripe.js version.');
				}
				return false;
			}

			let checkoutInit = checkoutInitializer(stripeObject);
			let self = this;
			this._mountPromise = new Promise(function(resolve, reject) {

				let setupCheckout = async function(checkout) {
					try {
						if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
							resolve(false);
							return false;
						}

						self._checkout = checkout;
						if ( typeof checkout.on === 'function' ) {
							checkout.on('change', function(session) {
								if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
									return;
								}

								self._checkoutCanConfirm = !! ( session && session.canConfirm );
							});
						}

						let loadActionsResult = await checkout.loadActions();
						if ( loadActionsResult.type !== 'success' ) {
							if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
								resolve(false);
								return false;
							}

							self.show_error(self.getStripeCheckoutErrorMessage(loadActionsResult.error));
							reject(loadActionsResult.error || new Error(window.ForminatorFront.cform.payment_failed));
							return false;
						}

						if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
							resolve(false);
							return false;
						}

						self._checkoutActions = loadActionsResult.actions;
						if ( typeof self._checkoutActions.getSession === 'function' ) {
							let session = self._checkoutActions.getSession();
							self._checkoutCanConfirm = !! ( session && session.canConfirm );
						}

						if (
							self.getStripeData('adaptivePricing')
							&& currencySelectorElement
							&& typeof checkout.createCurrencySelectorElement === 'function'
						) {
							self._currencySelectorElement = checkout.createCurrencySelectorElement();
							self._currencySelectorElement.mount('#payment-currency-selector-element-' + fieldId);
						}

						self._paymentElement = checkout.createPaymentElement(sanitizedPaymentOptions);
						self._paymentElement.mount('#payment-element-' + fieldId);

						if ( self.hasCheckoutContactElement() && contactElement && typeof checkout.createContactDetailsElement === 'function' ) {
							self._contactElement = checkout.createContactDetailsElement();
							self._contactElement.mount('#payment-contact-element-' + fieldId);
						}

						self.syncCheckoutCustomerDetails();
						resolve(true);
						return true;
					} catch ( error ) {
						if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
							resolve(false);
							return false;
						}

						self.show_error(self.getStripeCheckoutErrorMessage(error));
						reject(error);
						return false;
					}
				};

				if ( checkoutInit && typeof checkoutInit.then === 'function' ) {
					checkoutInit.then(setupCheckout).catch(function(error) {
						if ( ! self.isLatestCheckoutMountRequest(checkoutMountRequestId) ) {
							resolve(false);
							return;
						}

						self.show_error(self.getStripeCheckoutErrorMessage(error));
						reject(error);
					});
				} else {
					setupCheckout(checkoutInit);
				}
			});

			return this._mountPromise;
		},

		isLatestCheckoutMountRequest: function(checkoutMountRequestId) {
			return ! checkoutMountRequestId || checkoutMountRequestId === this._checkoutMountRequestId;
		},

		hideCardError: function () {
			// todo: it's for pagination
			var $field_holder = this.$el.find('.forminator-card-message');
			var $error_holder = $field_holder.find('.forminator-error-message');

			if ($error_holder.length === 0) {
				$field_holder.append('<span class="forminator-error-message" aria-hidden="true"></span>');
				$error_holder = $field_holder.find('.forminator-error-message');
			}

			$field_holder.closest('.forminator-field').removeClass('forminator-has_error');
			$error_holder.html('');
		},

		showCardError: function (message, focus) {
			// todo: it's for pagination
			var $field_holder = this.$el.find('.forminator-card-message');
			var $error_holder = $field_holder.find('.forminator-error-message');

			if ($error_holder.length === 0) {
				$field_holder.append('<span class="forminator-error-message" aria-hidden="true"></span>');
				$error_holder = $field_holder.find('.forminator-error-message');
			}

			$field_holder.closest('.forminator-field').addClass('forminator-has_error');
			$field_holder.closest('.forminator-field').addClass( 'forminator-is_filled' );
			$error_holder.html(message);

			if(focus) {
				this.focus_to_element($field_holder.closest('.forminator-field'));
			}
		},

		getStripeData: function (key) {
			if ( (typeof this._stripeData !== 'undefined') && (typeof this._stripeData[key] !== 'undefined') ) {
				return this._stripeData[key];
			}

			return null;
		},

		getObjectValue: function(object, key) {
			if (typeof object[key] !== 'undefined') {
				return object[key];
			}

			return null;
		},

		// taken from forminatorFrontCondition
		get_form_field: function (element_id) {
			//find element by suffix -field on id input (default behavior)
			var $element = this.$el.find('#' + element_id + '-field');
			if ($element.length === 0 && element_id) {
				//find element by its on name (for radio on single value)
				$element = this.$el.find('input[name=' + element_id + ']');
				if ($element.length === 0) {
					// for text area that have uniqid, so we check its name instead
					$element = this.$el.find('textarea[name=' + element_id + ']');
					if ($element.length === 0) {
						//find element by its on name[] (for checkbox on multivalue)
						$element = this.$el.find('input[name="' + element_id + '[]"]');
						if ($element.length === 0) {
							//find element by select name
							$element = this.$el.find('select[name="' + element_id + '"]');
							if ($element.length === 0) {
								$element = this.$el.find('select[name="' + element_id + '[]"]');
								if ($element.length === 0) {
									//find element by direct id (for name field mostly)
									//will work for all field with element_id-[somestring]
									$element = this.$el.find('#' + element_id);
								}
							}
						}
					}
				}
			}

			return $element;
		},

		get_field_value: function (element_id) {
			var $element = this.get_form_field(element_id);
			var value    = '';
			var checked  = null;

			if (this.field_is_radio($element)) {
				checked = $element.filter(":checked");
				if (checked.length) {
					value = checked.val();
				}
			} else if (this.field_is_checkbox($element)) {
				$element.each(function () {
					if ($(this).is(':checked')) {
						value = $(this).val();
					}
				});

			} else if (this.field_is_select($element)) {
				value = $element.val();
			} else if ( this.field_has_inputMask( $element ) ) {
				value = parseFloat( $element.inputmask( 'unmaskedvalue' ) );
			} else {
				value = $element.val()
			}

			return value;
		},

		field_has_inputMask: function ( $element ) {
			var hasMask = false;

			$element.each(function () {
				if ( undefined !== $( this ).attr( 'data-inputmask' ) ) {
					hasMask = true;
					//break
					return false;
				}
			});

			return hasMask;
		},

		field_is_radio: function ($element) {
			var is_radio = false;
			$element.each(function () {
				if ($(this).attr('type') === 'radio') {
					is_radio = true;
					//break
					return false;
				}
			});

			return is_radio;
		},

		field_is_checkbox: function ($element) {
			var is_checkbox = false;
			$element.each(function () {
				if ($(this).attr('type') === 'checkbox') {
					is_checkbox = true;
					//break
					return false;
				}
			});

			return is_checkbox;
		},

		field_is_select: function ($element) {
			return $element.is('select');
		},
	});

	// A really lightweight plugin wrapper around the constructor,
	// preventing against multiple instantiations
	$.fn[pluginName] = function (options) {
		return this.each(function () {
			if (!$.data(this, pluginName)) {
				$.data(this, pluginName, new ForminatorFrontStripe(this, options));
			}
		});
	};

})(jQuery, window, document);
