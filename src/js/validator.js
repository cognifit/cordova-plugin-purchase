(function() {


/// ## <a name="validator"></a> *store.validator*
/// Set this attribute to either:
///
///  - the URL of your purchase validation service ([example](#validation-url-example))
///     - [Fovea's receipt validator](https://billing.fovea.cc) or your own service.
///  - a custom validation callback method ([example](#validation-callback-example))
///
/// #### validation URL example
///
/// ```js
/// store.validator = "https://validator.fovea.cc"; // if you want to use Fovea **
/// ```
///
/// * **URL**
///
///   `/your-check-purchase-path`
///
/// * **Method:**
///
///   `POST`
///
/// * **Data Params**
///
///   The **product** object will be added as a json string.
///
///   Example body:
///
///   ```js
///   {
///     additionalData : null
///     alias : "monthly1"
///     currency : "USD"
///     description : "Monthly subscription"
///     id : "subscription.monthly"
///     loaded : true
///     price : "$12.99"
///     priceMicros : 12990000
///     state : "approved"
///     title : "The Monthly Subscription Title"
///     transaction : { // Additional fields based on store type (see "transactions" below)  }
///     type : "paid subscription"
///     valid : true
///   }
///   ```
///
///   The `transaction` parameter is an object, see [transactions](#transactions).
///
/// * **Success Response:**
///   * **Code:** 200 <br />
///     **Content:**
///     ```
///     {
///         ok : true,
///         data : {
///             transaction : { // Additional fields based on store type (see "transactions" below) }
///         }
///     }
///     ```
///     The `transaction` parameter is an object, see [transactions](#transactions).  Optional.  Will replace the product's transaction field with this.
///
/// * **Error Response:**
///   * **Code:** 200 (for [validation error codes](#validation-error-codes))<br />
///     **Content:**
///     ```
///     {
///         ok : false,
///         data : {
///             code : 6778003 // Int. Corresponds to a validation error code, click above for options.
///         }
///         error : { // (optional)
///             message : "The subscription is expired."
///         }
///     }
///     ```
///   OR
///   * **Code:** non-200 <br />
///   The response's *status* and *statusText* will be displayed in an formatted error string.
///
///
/// ** Fovea's receipt validator is [available here](https://billing.fovea.cc).
///
/// #### validation callback example
///
/// ```js
/// store.validator = function(product, callback) {
///
///     // Here, you will typically want to contact your own webservice
///     // where you check transaction receipts with either Apple or
///     // Google servers.
///     callback(true, { ... transaction details ... }); // success!
///     callback(true, { transaction: "your custom details" }); // success!
///         // your custom details will be merged into the product's transaction field
///
///     // OR
///     callback(false, {
///         code: store.PURCHASE_EXPIRED, // **Validation error code
///         error: {
///             message: "XYZ"
///         }
///     });
///
///     // OR
///     callback(false, "Impossible to proceed with validation");
///
///     // Here, you will typically want to contact your own webservice
///     // where you check transaction receipts with either Apple or
///     // Google servers.
/// });
/// ```
///
/// ** Validation error codes are [documented here](#validation-error-codes).
///
store.validator = null;

var validationRequests = [];
var timeout = null;

function runValidation() {
  store.log.debug('runValidation()');

  timeout = null;
  var requests = validationRequests;
  validationRequests = [];

  // Merge validation requests by products.
  var byProduct = {};
  requests.forEach(function(request) {
    var productId = request.product.id;
    if (byProduct[productId]) {
      byProduct[productId].callbacks.push(request.callback);
      // assume the most up to date value for product will come last
      byProduct[productId].product = request.product;
    }
    else {
      byProduct[productId] = {
        product: request.product,
        callbacks: [request.callback]
      };
    }
  });

  // Run one validation request for each product.
  Object.keys(byProduct).forEach(function(productId) {
      var request = byProduct[productId];
      var product = request.product;

      // Ensure applicationUsername is sent with validation requests
      if (!product.additionalData) {
          product.additionalData = {};
      }
      if (!product.additionalData.applicationUsername) {
          product.additionalData.applicationUsername =
              store.getApplicationUsername(product);
      }
      if (!product.additionalData.applicationUsername) {
          delete product.additionalData.applicationUsername;
      }

      // Post
      store.utils.ajax({
          url: store.validator,
          method: 'POST',
          data: product,
          success: function(data) {
              store.log.debug("validator success, response: " + JSON.stringify(data));
              request.callbacks.forEach(function(callback) {
                  callback(data && data.ok, data.data);
              });
          },
          error: function(status, message, data) {
              var fullMessage = "Error " + status + ": " + message;
              store.log.debug("validator failed, response: " + JSON.stringify(fullMessage));
              store.log.debug("body => " + JSON.stringify(data));
              request.callbacks.forEach(function(callback) {
                  callback(false, fullMessage);
              });
          }
      });
  });
}

function scheduleValidation() {
  store.log.debug('scheduleValidation()');
  if (timeout)
    clearTimeout(timeout);
  timeout = setTimeout(runValidation, 1500);
}

//
// ## store._validator
//
// Execute the internal validation call, either to a webservice
// or to the provided callback.
//
// Also makes sure to refresh the receipts.
//
store._validator = function(product, callback, isPrepared) {
    if (!store.validator) {
        callback(true, product);
        return;
    }

    if (store._prepareForValidation && isPrepared !== true) {
        store._prepareForValidation(product, function() {
            store._validator(product, callback, true);
        });
        return;
    }

    if (typeof store.validator === 'string') {
        validationRequests.push({
            product: product,
            callback: callback
        });
        scheduleValidation();
    }
    else {
        store.validator(product, callback);
    }
};

///
/// ## transactions
///
/// A purchased product will contain transaction information that can be
/// sent to a remote server for validation. This information is stored
/// in the `product.transaction` data. This field is an object with a
/// different format depending on the store type.
///
/// The `product.transaction` field has the following format:
///
/// - `type`: "ios-appstore" or "android-playstore"
/// - store specific data
///
/// #### store specific data - iOS
///
/// Refer to [this documentation for iOS](https://developer.apple.com/library/ios/releasenotes/General/ValidateAppStoreReceipt/Chapters/ReceiptFields.html#//apple_ref/doc/uid/TP40010573-CH106-SW1).
///
/// **Transaction Fields (Subscription)**
///
/// ```
///     appStoreReceipt:"appStoreReceiptString"
///     id : "idString"
///     original_transaction_id:"transactionIdString",
///     "type": "ios-appstore"
/// ```
///
/// #### store specific data - Android
///
/// Start [here for Android](https://developer.android.com/google/play/billing/billing_integrate.html#billing-security).
///
/// ```
/// developerPayload : undefined
/// id : "idString"
/// purchaseToken : "purchaseTokenString"
/// receipt : '{ // NOTE: receipt's value is string and will need to be parsed
///     "autoRenewing":true,
///     "orderId":"orderIdString",
///     "packageName":"com.mycompany",
///     "purchaseTime":1555217574101,
///     "purchaseState":0,
///     "purchaseToken":"purchaseTokenString"
/// }'
/// signature : "signatureString",
/// "type": "android-playstore"
/// ```
///
/// #### Fovea
///
/// Another option is to use [Fovea's validation service](http://billing.fovea.cc/) that implements
/// all the best practices to enhance your subscriptions and secure your transactions.
///

///
/// ## <a name="update"></a> *store.update*
///
/// Refresh the historical state of purchases and price of items.
/// This is required to know if a user is eligible for promotions like introductory
/// offers or subscription discount.
///
/// It is recommended to call this method right before entering your in-app
/// purchases or subscriptions page.
///
/// You can of `update()` as a light version of `refresh()` that won't ask for the
/// user password. Note that this method is called automatically for you on a few
/// useful occasions, like when a subscription expires.
///
store.update = function() {};

})();
