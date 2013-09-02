// Scope
// -----

// To avoid global scope pollution, declare all variables and functions inside an
// [immediately-invoked function expression](http://benalman.com/news/2010/11/immediately-invoked-function-expression/) using an augmented [module pattern](http://addyosmani.com/resources/essentialjsdesignpatterns/book/#modulepatternjavascript).
//
// @TODO: 
// - refactor to use tidy tables. I didn't realize it was in use when I wrote this
// - move table.queryParams.clauses properties from arrays to objects. this will create a nicer branch in logic dealing with
//   the calculate by values vs. the three variables
// [8/19/13 TS]
var PDP = (function ( pdp ) {

  'use strict';

  var table = {};

  table.$el = $('#summary-table-form');
  table.$page = $('#summary');

  // cache input fields
  table._inputs = {};
  table._inputs.all = $('*[data-summary-table-input]');
  table._inputs.varFields = [$('#variable0'), $('#variable1'), $('#variable2')];
  table._inputs.calculate = $('#calculate-by');

  table.genericError = 'Sorry, something went awry when we tried to load your data. Please try again?';

  // avert your eyes
  // we could call the api every time
  // or we can just do this
  // this is a subset of all available dimensions anyway
  table.fields = ['action_taken_name','agency_name', 'applicant_ethnicity_name', 'applicant_sex_name', 'applicant_race_name_1','census_tract_number','co_applicant_ethnicity_name','co_applicant_race_name_1','co_applicant_sex_name','county_name','denial_reason_name_1','hoepa_status_name','lien_status_name','loan_purpose_name','loan_type_name','msamd_name','owner_occupancy_name','preapproval_name','property_type_name','purchaser_type_name', 'respondent_id', 'state_name', 'as_of_year'];

  // map for select clause statements and calculate by field values
  table.metrics = {
    'count': {
      'api': 'COUNT()',
      'human': 'Number of records'
    },
    'min_applicant_income_000s': {
      'api': 'MIN(applicant_income_000s)',
      'human': 'Applicant Income Minimum'
    },
    'max_applicant_income_000s': {
      'api': 'MAX(applicant_income_000s)',
      'human': 'Applicant Income Maximum'
    },
    'avg_applicant_income_000s': {
      'api': 'AVG(applicant_income_000s)',
      'human': 'Applicant Income Average'
    },
    'min_loan_amount_000s': {
      'api': 'MIN(loan_amount_000s)',
      'human': 'Loan Amount Minimum'
    },
    'max_loan_amount_000s': {
      'api': 'MAX(loan_amount_000s)',
      'human': 'Loan Amount Maximum'
    },
    'avg_loan_amount_000s': {
      'api': 'AVG(loan_amount_000s)',
      'human': 'Loan Amount Average'
    },
    'sum_loan_amount_000s': {
      'api': 'SUM(loan_amount_000s)',
      'human': 'Loan Amount Sum'
    }
  };

  // holds onto user-selected options. consists of clauses object + pdp.query.params
  table.queryParams = {};

  // clauses = { select|group: ['var_name_0', 'var_name_1', 'var_name_2', 'calculate-by'] }
  table.queryParams.clauses = {};

  // returns a templated option tag
  table.optionTmpl = function(field, defaultOp) {
    var def = (defaultOp) ? 'selected' : '';

    return '<option value="' + field + '"' + def + '>' + pdp.utils.varToTitle( field ) + '</option>';
  };

  // fetches field names and populates select options
  table._populateOptions = function() {
    table._populateFields(table._inputs.varFields, table.fields, table.optionTmpl);
  };

  // populates variable and calculate by fields
  // inputs param: array or jQObjs or single jQObj
  // fields param: array of field values
  // tmpl: function that returns string of html
  table._populateFields = function(inputs, fields, tmpl) {
    var inputsLen = inputs.length,
        fieldsLen = fields.length - 1,
        i,
        domField,
        first = true;

    while (inputsLen--) {
      domField = inputs[inputsLen];

      for (i=0; i<=fieldsLen; i++) {
        domField.append(tmpl(fields[i]), first);

        first = false;
      }
    }
  };

  // inits chosen library to make pretty form fields
  table._chosenInit = function() {
    this.$el.find('select').chosen({
      width: '100%',
      disable_search_threshold: 10
    });
  };

  // event handler, called when a form field changes
  table.updateTable = function(e) {
    var value = $(e.target).val() || null,
        position = e.target.id.substr( -1, 1 ),
        clause = e.target.getAttribute('data-summary-table-input');

    // if the event occurred on the calculate by field, 
    // get the query string from the metrics map and
    // make sure it gets set to the third queryParams.clauses array 
    if ( e.target.id === 'calculate-by' ) {
      value = this.metrics[value].api;
      position = 3;
    }

    this.updateQuery(
      clause,
      value,
      position
    );

    // reset it before the data comes back and builds
    this.resetTable();

    this._requestData();

    this._updateFields( value, position );
  };

  // hide variables already selected from subsequent drop downs
  // or
  // show variables that are unselected due to column reset
  table._updateFields = function(value, position) {
    if ( position < 2 ) {
      for (position; position<=2; position++) {
        $('#variable' + position)
          .find('option[value=' + value + ']')
          .toggleClass('hidden')
          .trigger('liszt:updated');
      }
    }
  };

  table._requestData = function() {
    var responseJSON, check;

    function _abort( data, textStatus ) {
      $('body').append('<h3 class="ajax-error">The API timed out after ' + pdp.query.secondsToWait + ' seconds. :(</h3>');
        table._removeSpinner();
      $('.ajax-error').fadeOut( 5000 );
    }

    responseJSON = pdp.utils.getJSON( pdp.query.generateApiUrl( 'jsonp?$callback=', true, this.queryParams ) );

    responseJSON.done(function( response ){
      table._handleApiResponse( response );
      // clearInterval(check);
    });

    //responseJSON.fail( this._throwFetchError );
    responseJSON.fail( this._abort );

    $('.ajax-error').remove();
    check = setTimeout(function(){
      if ( responseJSON.state() !== 'resolved' ) {
        _abort( null, 'time out' );
      }
    }, pdp.query.secondsToWait * 1000 );

    // in the meantime, spin!
    this._showSpinner();
  };

  
  /**
   * This function performs output formatting of numbers in 1000s to a 
   * US dollar format.; i.e.,"23.52323423" to "$23,523".
   * The method includes multipling the original number by 1000, rounding to 
   * the nearest whole dollar, and then adding comma separators and '$'.
   *
   * The implementation should be something like :
   *    ```amount = Math.round( the_number * 1000 ).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");```
   *    All non numerical values of ``the_number``` should be emitted as blanks; e.g., null and ""
   *    are represented as nothing on the screen.
   *  
   * */
  table._mungeDollarAmts = function( respData ) {
    var record, column, variable, amount, addCommas, dotIndex, amtParts, num;

    // for row in results
    for ( record in respData.results ) {
      if ( respData.results.hasOwnProperty( record ) ) {
        // for variable in row
        for ( column in respData.results[record] ) {

          // if this is a calculate by field value
          if ( this.metrics.hasOwnProperty( column ) ) {

            num = respData.results[record][column];
            
            if ( num === null || num === '' || isNaN(num) ) {
              respData.results[record][column] = 'Data not available';
            }
            else if (num < 0) {
              respData.results[record][column] = 'Data format error! A non-positive numerical value found in original data: ' + num;
            }
            // We don't want to add a dollar sign if it's a record count.
            else if ( column === 'count' ) {
              respData.results[record][column] = pdp.utils.commify( num );
            }
            else {
              respData.results[record][column] = '$' + Math.round( num*1000 ).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            }
          }
        }
      }
    }

    return respData;
  };


  table._handleApiResponse = function( response ) {
    this.populateTable(this._prepData(response));
  };


  table._prepData = function( respData ) {
    respData = this._mungeDollarAmts( respData );

    return respData;
  };

  table._showSpinner = function() {
    this.$page.addClass('loading');
  };

  table._removeSpinner = function() {
    this.$page.removeClass('loading');
  };

  // removes table contents
  // resets table headers to current choices
  table.resetTable = function() {
    var $table = $('table#summary-table');
    $table.empty();
    this.updateTableHeaders();
  };

  // takes query for calculate by field and
  // returns the value representation
  // ex. AVG(applicant_income_000s) to avg_applicant_income_000s
  table.queryToVal = function( qstr ) {
    var val, i;

    // split on parentheses
    val = qstr.split(/\(|\)/);

    i = val.length;
    while (i--) {
      if ( val[i] === '' ) {
        val.splice(i, 1);
      }
    }

    val = val.join('_').toLowerCase();

    return val;
  };

  // builds out table body from API JSON response data
  table.populateTable = function( responseData ) {
    var total, result, column, i, $tr, cellValue,
        $table = $('table#summary-table'),
        len = responseData.results.length - 1,
        clauses, clauseLen = this.queryParams.clauses.select.length;

    this._removeSpinner();

    if ( !_.isEmpty(responseData.errors) ) {
      this._throwFetchError();
      return;
    }

    for (i=0; i<=len; i++) {
      $tr = $('<tr></tr>');

      for ( column=0; column<clauseLen; column++ ) {

        if ( typeof this.queryParams.clauses.select[column] !== 'undefined' ) {
          // reads like
          // cellValue = response data object -> iteration we're on -> object key that matches the 
          // select clause array item for the inner interation we're on
          cellValue = responseData.results[i][this.queryParams.clauses.select[column]];

          // the column value won't match on calculate fields w/o some manipulation
          if ( typeof cellValue === 'undefined' ) {
            cellValue = responseData.results[i][this.queryToVal( this.queryParams.clauses.select[column] )];
            // if it's still undefined, gtfo
            if ( typeof cellValue === 'undefined' ) {
              cellValue = '<em class="not-reported">not reported</em>';
            }
          }
          $tr.append('<td>' + cellValue + '</td>');
        }
      }

      $table.append($tr);
    }

  };

  table._throwFetchError = function() {
      pdp.utils.showError( this.genericError );
  };

  // remove the var name from the queryParams.clauses arrays
  // recursive if the data attribute data-summary-table-input
  // is set to "both" to update both select and group arrays
  table.resetColumn = function( clause, position ) {
    var removedValue;
    if ( clause === 'both' ) {
      delete( this.queryParams.clauses['select'][position] );
      this.resetColumn( 'group', position );
      return;
    }

    removedValue = this.queryParams.clauses[clause][position];

    delete( this.queryParams.clauses[clause][position] );

    this.resetTable();
    this._updateFields( removedValue, position );
    this._requestData( clause, position );
  };

  // updates object that reflects selected form options
  // recursive if the data attribute data-summary-table-input
  // is set to "both" to update both select and group arrays
  table.updateQuery = function( clause, value, position ) {

    if ( clause === 'both') {
      this.updateQuery( 'select', value, position );
      this.updateQuery( 'group', value, position );
      return;
    }

    // if its the first time this clause is being used, create new array
    if ( typeof this.queryParams.clauses[clause] === 'undefined' ) {
      this.queryParams.clauses[clause] = [];
    }

    this.queryParams.clauses[clause][position] = value;

    // re-copies the filters
    this.queryParams.clauses.where = pdp.query.params;

  };

  // create structure of table
  table.createTable = function() {
    $('#summary-table-container').append('<table id="summary-table"></table>');
    this.$table = $('table#summary-table');

    return this.$table;
  };

  // generates <tr> of column headers
  table.updateTableHeaders = function() {
    var $table = $('table#summary-table'),
        $headerRow = $('<tr class="header"></tr>'),
        columns = this.queryParams.clauses.select.slice(0),
        i, val, fieldVal,
        len = columns.length;

    for (i=0; i<=len; i++) {
      if (typeof columns[i] !== 'undefined') {
        // 3 = array index of calculate by
        // calculate by = 3d vs. 2d since it has value id, 
        // query representation and human representation
        if ( i === 3 ) {
          // walk the calculate by or metrics map for the correct title
          fieldVal = this.queryToVal( columns[i] );
          if ( this.metrics.hasOwnProperty( fieldVal ) ) {
            columns[i] = this.metrics[fieldVal].human;
          }
        }
        $headerRow.append('<td id="' + fieldVal + '">' + pdp.utils.varToTitle( columns[i] ) + '</td>');
      }
    }

    $table.prepend($headerRow);
  };

  table.init = function() {
    table._populateOptions();
    table._chosenInit();
    table.createTable();
    table.disableDownload();

    // fields should be disabled until a first variable is selected
    // we don't want users selecting subsequent vars when earlier
    // ones are undefined
    $('#variable1, #variable2, #calculate-by').attr('disabled', 'disabled').trigger('liszt:updated');

    // event listener for form changes
    this._inputs.all.on('change', function(e) {
      this.updateTable(e);

      if (e.target.id !== 'calculate-by') {
        var position = e.target.id.substr( -1, 1 );

        // enable subsequent variable field and calculate-by field
        $('#calculate-by, #variable'.concat(++position)).removeAttr('disabled').trigger('liszt:updated');

        // if this is variable 1 or 2, they're eligible to be removed, show link
        if (position > 0) {
          $('#reset-' + e.target.id).removeClass('hidden');
        }
      }

      // Enable the download box if a variable is selected.
      if ( this.queryParams.clauses.group.length > 0 ) {
        this.enableDownload();
      } else {
        this.disableDownload();
      }

    }.bind(this));

    $('.reset-field').on('click', function(e) {
      e.preventDefault();
      var position = e.target.id.substr( -1, 1 ),
          clause = e.target.getAttribute('data-summary-table-input');

      this.resetColumn( clause, position );
      $(e.target).addClass('hidden');
      $('#variable' + position)
        .find('option:first-child')
        .prop('selected', true)
        .end()
        .trigger('liszt:updated');

      $('#variable'.concat(++position)).attr('disabled', 'disabled').trigger('liszt:updated');

    }.bind( this ));
  };

  // The `disableDownload` method disables the summary table download block.
  table.disableDownload = function() {

    var $el = $('#download-summary');

    $el.addClass('disabled').find('select, input').attr('disabled', 'disabled');

  };

  // The `enableDownload` method enables the summary table download block.
  table.enableDownload = function() {

    var $el = $('#download-summary');

    $el.removeClass('disabled').find('select, input').removeAttr('disabled');

  };

  pdp.summaryTable = table;

  return pdp;

}( PDP || {} ));
