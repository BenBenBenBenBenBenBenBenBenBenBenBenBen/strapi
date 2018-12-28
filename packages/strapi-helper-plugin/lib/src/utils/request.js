import 'whatwg-fetch';
import auth from 'utils/auth';

/**
 * Parses the JSON returned by a network request
 *
 * @param  {object} response A response from a network request
 *
 * @return {object}          The parsed JSON from the request
 */
function parseJSON(response) {
  return response.json ? response.json() : response;
}

/**
 * Checks if a network request came back fine, and throws an error if not
 *
 * @param  {object} response   A response from a network request
 *
 * @return {object|undefined} Returns either the response, or throws an error
 */
function checkStatus(response, checkToken = true) {
  if (response.status >= 200 && response.status < 300) {
    return response;
  }

  if (response.status === 401 && auth.getToken() && checkToken) {
    return checkTokenValidity(response);
  }

  return parseJSON(response).then(responseFormatted => {
    const error = new Error(response.statusText);
    error.response = response;
    error.response.payload = responseFormatted;
    throw error;
  });
}

function checkTokenValidity(response) {
  const options = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${auth.getToken()}`,
    },
  };

  if (auth.getToken()) {
    return fetch(`${strapi.backendURL}/user/me`, options)
      .then(() => {
        if (response.status === 401) {
          window.location = `${strapi.remoteURL}/plugins/users-permissions/auth/login`;

          auth.clearAppStorage();
        }

        return checkStatus(response, false);
      });
  }
}

/**
 * Format query params
 *
 * @param params
 * @returns {string}
 */
function formatQueryParams(params) {
  return Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&');
}

/**
* Server restart watcher
* @param response
* @returns {object} the response data
*/
function serverRestartWatcher(response) {
  return new Promise((resolve) => {
    fetch(`${strapi.backendURL}/_health`, {
      method: 'HEAD',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
        'Keep-Alive': false,
      },
    })
      .then(() => {
        // Hide the global OverlayBlocker
        strapi.unlockApp();
        resolve(response);
      })
      .catch(() => {
        setTimeout(() => {
          return serverRestartWatcher(response)
            .then(resolve);
        }, 100);
      });
  });
}

/**
 * Requests a URL, returning a promise
 *
 * @param  {string} url       The URL we want to request
 * @param  {object} [options] The options we want to pass to "fetch"
 *
 * @return {object}           The response data
 */
export default function request(url, options = {}, shouldWatchServerRestart = false, stringify = true ) {
  // Set headers
  if (!options.headers) {
    options.headers = Object.assign({
      'Content-Type': 'application/json',
    }, options.headers, {
      'X-Forwarded-Host': 'strapi',
    });
  }

  const token = auth.getToken();

  if (token) {
    options.headers = Object.assign({
      'Authorization': `Bearer ${token}`,
    }, options.headers);
  }

  // Add parameters to url
  url = _.startsWith(url, '/') ? `${strapi.backendURL}${url}` : url;

  if (options && options.params) {
    const params = formatQueryParams(options.params);
    url = `${url}?${params}`;
  }

  // Stringify body object
  if (options && options.body && stringify) {
    options.body = JSON.stringify(options.body);
  } else if (options && options.body) {
    // Iterate through fields and check if we have a file field
    // If we have a file field iterate through the files and add captions
    // to a caption array. 
    let fileFields = [];
    for (const field of options.body.entries()) {
      if (field[1] instanceof File) {
        fileFields.push(field[0]);
      }
    }
    // Alright so it looks like we really do need to have a separate field for captions
    // FormData.append will always convert values to a string unless they are a file.
    // We could just stringify the object if it didn't also contain a File.
    fileFields = Array.from(new Set(fileFields));
    for (const field of fileFields) {
      const files = [];
      for (const fileEntry of options.body.getAll(field)) {
        files.push({
          caption: fileEntry.caption,
          file: fileEntry
        })
      }
      // options.body.set(field, JSON.stringify(files));
    }
    console.log(options.body);
    // const data = Array.from(options.body.entries()).reduce((memo, pair) => ({
    //   ...memo,
    //   [pair[0]]: pair[1],
    // }), {});
    // console.log(data);
    // options.body.append("caption", data.media.caption)
  }

  // if (options && options.body) {
  //   const data = Array.from(options.body.entries()).reduce((memo, pair) => ({
  //     ...memo,
  //     [pair[0]]: pair[1],
  //   }), {});
  //   options.body.append("caption", data.media.caption)
  // }

  return fetch(url, options)
    .then(checkStatus)
    .then(parseJSON)
    .then((response) => {
      if (shouldWatchServerRestart) {
        // Display the global OverlayBlocker
        strapi.lockApp();
        return serverRestartWatcher(response);
      }

      return response;
    });
}
