import React from 'react';
import {
  Criteria,
  DEFAULT_HI,
  DEFAULT_LO,
  DEFAULT_LOC,
  LikeStatus,
  PeriodData,
  WeatherPeriod
} from './models';
import {AsyncStorage} from 'react-native'
import Uuid from 'react-native-uuid'
import axios from 'axios';
import SafeAreaInsets from 'react-native-safe-area';
// @ts-ignore
import GetLocation from 'react-native-get-location';
import SafeArea from "react-native-safe-area";

import {
  PredictedRatings,
  CollaborativeFilter
} from '../util/CollaborativeFilter';
import {DUMMY_DAYS} from "../data/dummyDays";
import {forecastJackson} from "../data/forecast";

const GlobalContext = React.createContext({});

interface Location {
  latitude: number;
  longitude: number;
}

type ByPointsData = {
  data: {
    properties: {
      forecast: string,
      relativeLocation: {
        properties: {
          city: string
          state: string
        }
      }
    }
  }
}


type ForecastData = {
  data: {
    properties: {
      periods: Array<PeriodData>
    }
  }
}


export class GlobalState {
  public currCriteria: Criteria = new Criteria();
  public criteriaList: Array<Criteria> = [];
  public periods: Array<WeatherPeriod> = [];
  public loading: boolean = false;
  public history: Array<WeatherPeriod> = [];
  public location: Location = DEFAULT_LOC;
  public safeAreaInsets: SafeAreaInsets =
    {top: 20, bottom: 0, left: 0, right: 0}
  public city: string = 'Loading...';
  public todayRatings = new PredictedRatings();
}

export class GlobalContextProvider extends React.Component<any, GlobalState> {
  constructor(props: any) {
    super(props);
    this.state = new GlobalState()
  }

  toClass = (obj: any, proto: object) => {
    obj.__proto__ = proto;
    return obj;
  }

  appInit = async() => {
    let { safeAreaInsets } = await SafeArea.getSafeAreaInsetsForRootView();
    this.setState({
      safeAreaInsets
    })
    // LOAD
    let stored = await this.loadSavedState();
    // SET
    let periods: WeatherPeriod[] = (stored.periods || [])
      .map(v => this.toClass(v, WeatherPeriod.prototype));
    let criteriaList: Criteria[] = (stored.criteriaList || [])
      .map(v => this.toClass(v, Criteria.prototype));
    let currCriteria: Criteria = Object.assign(new Criteria(), stored.currCriteria);
    // let history = (stored.history || [])
    //   .map(v => this.toClass(v, WeatherPeriod.prototype));
    // let history = DUMMY_DAYS;
    let history = forecastJackson.data.properties.periods
      .map((p: any) => new WeatherPeriod(p))
      .filter(p => p.isDaytime);

    // console.log(history);
    for (let p of periods) {
      p.setPredictedGoodness(history);
      console.log(p.prediction)
    }

    this.setState({
      periods,
      currCriteria,
      criteriaList,
      history
    });

    setTimeout(async () => {
      await this.requestLocation(history);
    }, 250);
  }

  loadSavedState = async () => {
    let ret = new GlobalState();
    try {
      ret.currCriteria = JSON.parse(
        await AsyncStorage.getItem('curr') as string) || ret.currCriteria;
      ret.currCriteria.uuid = Uuid.v1();
      ret.periods = JSON.parse(
        await AsyncStorage.getItem('periods') as string) || ret.periods;
      ret.criteriaList = JSON.parse(
        await AsyncStorage.getItem('criteriaList') as string) || ret.criteriaList;
      ret.history = JSON.parse(
        await AsyncStorage.getItem('history') as string) || ret.history;

      // alert(JSON.stringify(ret.history));
    } catch (error) {
    }
    return ret;
  }

  saveState = async () => {
    const {periods, history} = this.state;
    try {
      await AsyncStorage.setItem(
        'periods', JSON.stringify(periods));
      await AsyncStorage.setItem(
        'history', JSON.stringify(history));
    } catch (error) {
    }
  };

  onChangeTemp = (t: string, which: string) => {
    let currCriteria = this.state.currCriteria;
    if (which === 'hi') {
      currCriteria.maxGoodTemp = t;
    } else if (which === 'lo') {
      currCriteria.minGoodTemp = t;
    } else if (which === 'mw') {
      currCriteria.maxWind = t;
    }
    this.setState({
      currCriteria
    })
  }

  fetchData = async (location: Location, history: WeatherPeriod[]) => {
    location = location || DEFAULT_LOC;
    let long = location.longitude.toFixed(1);
    let lat = location.latitude.toFixed(1);
    let url = `https://api.weather.gov/points/${lat},${long}`;
    let data: ByPointsData = await axios.get(url);
    let forecastUrl = data.data.properties.forecast;
    let dataFc: ForecastData = await axios.get(forecastUrl);
    let periods = dataFc.data.properties.periods
      .map((p: any) => new WeatherPeriod(p))
      .filter(p => p.isDaytime)
    periods.forEach((v, i, a) => {
      if (v.isRainy && i < a.length - 1) {
        a[i + 1].wasYesterdayRainy = true;
      }
    })
    if (periods.length > 0 && history.length > 0) {
      let alreadyThere = history[0];
      if (periods[0].date == alreadyThere.date) {
        periods[0].likedStatus = alreadyThere.likedStatus;
      }
    }
    for (let p of periods) {
      p.setPredictedGoodness(history);
    }
    // for (let p of periods) {
    //   p.predictedGoodness = CollaborativeFilter.predict(history, p);
    // }
    let {city, state} = data.data.properties.relativeLocation.properties;
    this.setState({
      location,
      periods,
      loading: false,
      city: `${city}, ${state}`,
    });
  }

  addCriteria = async () => {
    let cc = this.state.currCriteria;
    let min = parseFloat(String(cc.minGoodTemp) || DEFAULT_LO);
    let max = parseFloat(String(cc.maxGoodTemp) || DEFAULT_HI);
    if (min > max) {
      cc.minGoodTemp = max;
      cc.maxGoodTemp = min;
    }
    cc.maxWind = parseFloat(cc.maxWind);
    this.setState({
      criteriaList: [cc, ...this.state.criteriaList],
      currCriteria: Criteria.fromOther(cc)
    })
    await AsyncStorage.setItem(
      'curr', JSON.stringify(this.state.currCriteria));
    await AsyncStorage.setItem(
      'criteriaList', JSON.stringify(this.state.criteriaList));
  }

  delCriteria = (uuid: string) => {
    let criteriaList = this.state.criteriaList
      .filter(v => v.uuid !== uuid);
    this.setState({
      criteriaList
    });
    this.saveState();
  }

  requestLocation = async (history: WeatherPeriod[]) => {
    this.setState({
      loading: true,
      location: {latitude: 0, longitude: 0}
    });
    let location = null;
    try {
      location = await GetLocation.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 5000,
      });
    } catch ({code, message}) {
      this.setState({
        loading: false,
      });
    }
    await this.fetchData(location, history);
  }

  onChangeRain = (which: string) => {
    let curr = this.state.currCriteria;
    if (which === 'curr') {
      curr.rainOkay = !curr.rainOkay;
      if (curr.rainOkay) {
        curr.prevDayRainOkay = true;
      }
    } else if (which === 'prev') {
      curr.prevDayRainOkay = !curr.prevDayRainOkay;
    }
    this.setState({
      currCriteria: curr,
    })
  }

  setLikeStatus = async (which: LikeStatus): Promise<void> => {
    let { periods, history } = this.state;
    const fst = periods[0];
    const curr = fst.likedStatus;

    if (which === curr) {
      fst.likedStatus = LikeStatus.NEUTRAL;
    } else if (which === -curr) {
      fst.likedStatus = -fst.likedStatus;
    } else {
      fst.likedStatus = which;
    }

    let existing = history
        .find(h => h.date === fst.date);
    if (!existing) {
      history = [fst, ...history];
    } else {
      if (fst.likedStatus == LikeStatus.NEUTRAL ) {
        let d = existing.date || '';
        history = history.filter((h) =>
            h.date !== d);
      } else {
        existing.likedStatus = which;
      }
    }
    this.setState({
      history,
      periods
    })
    // await this.saveState();
    await AsyncStorage.setItem('history', JSON.stringify(history));
    // alert('saved! \n' + (await AsyncStorage.getItem('history')));
  }

  render () {
    const {children} = this.props;
    return (
      <GlobalContext.Provider
        value={{
          ...this.state,
          saveState: this.saveState,
          loadSavedState: this.loadSavedState,
          onChangeTemp: this.onChangeTemp,
          onChangeRain: this.onChangeRain,
          addCriteria: this.addCriteria,
          delCriteria: this.delCriteria,
          appInit: this.appInit,
          thumbPress: this.setLikeStatus,
        }}
      >
        {children}
      </GlobalContext.Provider>
    )
  }
}

// create the consumer as higher order component
export const withGlobalContext = (ChildComponent: any) => (props: any) => (
  <GlobalContext.Consumer>
    {
      context => <ChildComponent {...props} global={context}  />
    }
  </GlobalContext.Consumer>
);
