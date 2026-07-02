"use strict";

/*
=========================================================
GARGO TMS
Role Based Access Control
Version 2.0
=========================================================
*/

export const Roles = Object.freeze({
    ADMIN: "admin",
    DISPATCHER: "dispatcher",
    CLERK: "clerk",
    DRIVER: "driver"
});

export const Permissions = {

    dashboard : [
        Roles.ADMIN
    ],

    dispatch : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK
    ],

    allocation : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK
    ],

    bookings : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK
    ],

    shutouts : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK,
        Roles.DRIVER
    ],

    interchange : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK,
        Roles.DRIVER
    ],

    workshop : [
        Roles.ADMIN,
        Roles.DRIVER
    ],

    requisitions : [
        Roles.ADMIN,
        Roles.DRIVER
    ],

    fuel : [
        Roles.ADMIN,
        Roles.DRIVER
    ],

    maintenance : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK
    ],

    reports : [
        Roles.ADMIN
    ],

    audit : [
        Roles.ADMIN
    ],

    notifications : [
        Roles.ADMIN,
        Roles.DISPATCHER,
        Roles.CLERK,
        Roles.DRIVER
    ]
};

export function hasPermission(role,moduleName){

    if(!Permissions[moduleName])
        return false;

    return Permissions[moduleName].includes(role);

}

export function isAdmin(role){

    return role===Roles.ADMIN;

}

export function canDelete(role){

    return role===Roles.ADMIN;

}

export function canEdit(role){

    return role===Roles.ADMIN;

}

export function canApprove(role){

    return role===Roles.ADMIN;

}

export function canResolveMaintenance(role){

    return role===Roles.ADMIN;

}

export function canManageWorkshop(role){

    return role===Roles.ADMIN;

}

export function canManageRequisition(role){

    return role===Roles.ADMIN;

}