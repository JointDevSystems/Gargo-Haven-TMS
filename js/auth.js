"use strict";

import {

    Roles

} from "./permissions.js";

export function getRole(profile){

    if(!profile)
        return Roles.DRIVER;

    switch(profile.role){

        case "admin":

            return Roles.ADMIN;

        case "dispatch":

            return Roles.DISPATCHER;

        case "clerk":

            return Roles.CLERK;

        case "driver":

            return Roles.DRIVER;

        default:

            return Roles.DRIVER;

    }

}