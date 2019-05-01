import assert from 'assert';
import SpinnerBehavior from 'behaviors/Spinner';
import GenericForm from 'modules/GenericForm';
import SearchInput from 'modules/filters/SearchInput';
import {getInstance, CustomError} from 'helpers/classes';
import ViewWithDropdown from 'modules/ViewWithDropdown';
import PopupSection from 'modules/PopupSection';
import ErrorView from './modules/ErrorView';
import template from './template.jst';
import './styles.scss';


class PromiseRejectedError extends CustomError {}

/**
 * Components, that realizes logic of searching using generic form
 *
 * config: {
 *      form: {GenericForm},
 *      resultsView: {Marionette.View},
 *      getResults: {string|function} - url to get results, or function that will get it
 *      prepareResults: {function} - function that is invoked before data is set to results view
 * }
 */

export default class GenericFormWithSearchResults extends Marionette.View {
    /**
     * List of CSS classes, that is used in view
     *
     * @type {object}
     */
    static CSS = {
        BASE: 'generic-form-with-search-results',
        HIDE_RESULTS_LIST: 'generic-form-with-search-results--results-view-hidden'
    };

    baseBehaviors() {
        return [SpinnerBehavior];
    }

    options() {
        return {
            form: null,
            resultsView: null,
            searchPlaceholder: undefined,
            getResults: '',
            prepareResults: null
        };
    }

    initialize(options) {
        assert(options.form instanceof GenericForm, `Form should be an instance of GenericForm, "${getInstance(options.form)}" given`);
        assert(options.resultsView instanceof Marionette.View || options.resultsView instanceof Marionette.CollectionView, `Results view should be an instance of the marionette view, "${getInstance(options.resultsView)}" given`);
        assert(options.resultsView.collection instanceof Backbone.Collection, 'Results view should have a collection to contain search results');
        assert(typeof options.getResults === 'string' || typeof options.getResults === 'function', `URL or function to get results should be provided, "${typeof options.getResults}" given`);

        /**
         * Form view
         *
         * @type {GenericForm}
         */
        this._formView = options.form;

        /**
         * Contains function that can reject last sent search request (or null if no request is pending at the moment)
         *
         * @type {function|null}
         */
        this._rejectLastSearchRequest = null;

        /**
         * Results view
         *
         * @type {Marionette.View}
         */
        this._resultsView = options.resultsView;
        this.listenTo(
            this._resultsView.collection,
            'reset update',
            this._refreshCollapsingStatusOfTheResultsView
        );
        this.listenTo(
            this._formView.model.getFields(),
            'reset update sync',
            this._onFormFieldsCollectionChange
        );
        this.listenTo(this.getSearchInput(), 'clear submit blur', this._togglePopupVisibility);

        this._refreshCollapsingStatusOfTheResultsView();
        this.getFormView().setHookHandler('onShowSavingProgress', (progress) => {
            this.blockTillDone(progress);
            return false;
        });
    }

    className() {
        return this.constructor.CSS.BASE;
    }

    childViewTriggers() {
        return {
            'form:saved': 'form:saved',
            reject: 'reject'
        };
    }

    template(data) {
        return template(data);
    }

    regions() {
        return {
            search: '.js-generic-form-with-search-results__top-area__search-input-region',
            formRegion: '.js-generic-form-with-search-results__form-region',
            resultsViewRegion: '.js-generic-form-with-search-results__results-view-region'
        };
    }

    onRender() {
        // TODO: move search input config to parent views (because it may differs between views)
        this.showChildView('search',
            new ViewWithDropdown({
                view: new SearchInput({
                    model: {
                        placeholder: this.options.searchPlaceholder
                    }
                }),
                dropdown: new PopupSection({
                    model: {
                        bodyView: new ErrorView({onClick: () => {
                            this.getPopup().hide()
                        }})
                    }
                })
            })
        );
        this.showChildView('formRegion', this._formView);
        this.showChildView('resultsViewRegion', this._resultsView);
    }

    onAttach() {
        this.resize();
    }

    /**
     * Returns search input
     *
     * @returns {SearchInput}
     */
    getSearchInput() {
        return this.getChildView('search').getView();
    }

    /**
     * Returns input dropdown popup
     *
     * @returns {PopupSection}
     */
    getPopup() {
        return this.getChildView('search').getPopup();
    }

    /**
     * Returns form view
     *
     * @returns {GenericForm}
     */
    getFormView() {
        return this._formView;
    }

    /**
     * Returns results view
     *
     * @returns {Marionette.View}
     */
    getResultsView() {
        return this._resultsView;
    }

    /**
     * Resize the component
     *
     * @returns {GenericFormWithSearchResults}
     */
    resize() {
        if (this.isRendered()) {
            const middleWrapper = this._formView.getUI('middleWrapper');
            this.getRegion('resultsViewRegion').$el.height(middleWrapper.height());
            this.getResultsView().resize();
        }
        return this;
    }

    /**
     * Set maximum height to the form
     *
     * @param {number} height
     *
     * @returns {GenericFormWithSearchResults}
     */
    setMaxHeight(height) {
        this.$el.css('max-height', height);
        this._formView.setMaxHeight(height);
        return this;
    }


    /**
     * Show popup if there is no search results
     *
     * @returns {void}
     *
     * @private
     */
    async _togglePopupVisibility() {
        let results;

        try {
            results = await this._refreshSearchResults();
            // debugger;

        }
        catch (e) {
            // Do nothing if promise was rejected manually:
            if (e instanceof PromiseRejectedError) {
                return;
            }
            throw e;
        }

        console.log(results)
        if (!results || results.length === 0) {
            this.getPopup().show();
        }
        else {
            this.getPopup().hide();
        }
        this._refreshCollapsingStatusOfTheResultsView()
    }

    /**
     * Handler for an event that is fired when form fields collection changes
     *
     * @returns {void}
     *
     * @private
     */
    _onFormFieldsCollectionChange() {
        console.log('collection change')
        setTimeout(() => {
            this.resize();
        }, 0);
    }

    /**
     * Collapse or expand results view
     *
     * @returns {GenericFormWithSearchResults}
     *
     * @private
     */
    _refreshCollapsingStatusOfTheResultsView() {
        if (this._resultsView.collection.length) {
            this._expandResultsView();
        }
        else {
            this._collapseResultsView();
        }
        return this;
    }

    /**
     * Expand results list
     *
     * @returns {GenericFormWithSearchResults}
     *
     * @private
     */
    _expandResultsView() {
        this.$el.removeClass(this.constructor.CSS.HIDE_RESULTS_LIST);
        return this;
    }

    /**
     * Collapse results list
     *
     * @returns {GenericFormWithSearchResults}
     *
     * @private
     */
    _collapseResultsView() {
        this.$el.addClass(this.constructor.CSS.HIDE_RESULTS_LIST);
        return this;
    }

    /**
     * Refresh search results
     *
     * @returns {void}
     *
     * @private
     */
    _lastSearchCriteria = {};
    async _refreshSearchResults() {
        // Fetch result that matches the given criteria (if this criteria is not equal to previous):
        const searchCriteria = this.isRendered() ?
        // TODO: temorary search only by name:
        {FirstName: this.getSearchInput().getValue()} :
        {};
        console.log(searchCriteria)
        if (!_.isEqual(searchCriteria, this._lastSearchCriteria)) {
            const resultsLoading = await this._loadSearchResultsIntoTable(searchCriteria);
            this._lastSearchCriteria = searchCriteria;
            return resultsLoading;
        }
    };

    /**
     * Load search results into results view
     *
     * @param {object|null} criteria
     *
     * @returns {Promise.<void>}
     *
     * @private
     */
    async _loadSearchResultsIntoTable(criteria = null) {
        let request = this._fetchResultsSingle(criteria);
        this._resultsView.blockTillDone(request);
        request = request.catch((e) => {
            const group = 'fetchResultsForCriteria::fetchDataError';
            const message = e.message;
            this._formView.model.getErrors()
                .removeModelsOfGroup(group)
                .add({group, message});
            return [];
        });
        console.log('before request');
        const results = await request;
        console.log('after request');

        const preparedResults = this._prepareDataForResultsView(results);
        this._resultsView.collection.reset(preparedResults);
        return preparedResults;
    }

    /**
     * Fetch results from server, but keep only one request alive (kill old request if new one sent)
     *
     * @param {object|null} criteria
     *
     * @returns {Promise}
     *
     * @private
     */
    async _fetchResultsSingle(...params) {
        // Reject last sent request if needed:
        if (this._rejectLastSearchRequest) {
            this._rejectLastSearchRequest();
        }

        return new Promise((resolve, reject) => {
            // save rejection function to be able to reject this request if needed:
            this._rejectLastSearchRequest = () => {
                reject(new PromiseRejectedError('Request is cancelled'));
                this._rejectLastSearchRequest = null;
            };

            // Clear saved rejection function:
            this._fetchResults(...params).then(
                (result) => {
                    this._rejectLastSearchRequest = null;
                    resolve(result);
                },
                (e) => {
                    this._rejectLastSearchRequest = null;
                    reject(e);
                }
            );
        });
    }

    /**
     * Fetch results, that matches given criteria
     *
     * @param {object|null} criteria
     *
     * @returns {Promise}
     *
     * @private
     */
    async _fetchResults(criteria = null) {
        return typeof this.options.getResults === 'function' ?
            this.options.getResults(criteria) :
            new Promise((resolve, reject) => {
                $.ajax({
                    method: 'GET',
                    url: this.options.getResults,
                    data: criteria || {},
                    success: data => resolve(data),
                    error: (jqXHR, textStatus, errorThrown) => reject(new Error(errorThrown))
                });
            });
    }

    /**
     * Prepares data from server to be loaded in results view
     *
     * @param {*} data
     *
     * @returns {Array}
     *
     * @private
     */
    _prepareDataForResultsView(data) {
        return typeof this.options.prepareResults === 'function' ?
            this.options.prepareResults(data) :
            data;
    }
}
