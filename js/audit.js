"use strict";

/*
Enterprise Audit Service
*/

export async function writeAudit(

    action,
    module,
    record,
    before,
    after

){

    if(!window.state) return;

    const user=window.state.profile?.username || "Unknown";

    const audit={

        id:crypto.randomUUID(),

        user,

        action,

        module,

        record,

        before,

        after,

        timestamp:new Date().toISOString()

    };

    window.state.db.auditLog.unshift(audit);

    if(window.saveDatabase){

        await window.saveDatabase();

    }

}