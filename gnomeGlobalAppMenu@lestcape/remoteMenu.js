// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

const Atk = imports.gi.Atk;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const ShellMenu = imports.gi.ShellMenu;
const St = imports.gi.St;

const PopupMenu = imports.ui.popupMenu;

const MyExtension = imports.misc.extensionUtils.getCurrentExtension();
const ConfigurableMenus = MyExtension.imports.configurableMenus;

function stripMnemonics(label) {
    if (!label)
        return '';
    // remove all underscores that are not followed by another underscore
    return label.replace(/_([^_])/, '$1');
}

function _insertItem(menu, trackerItem, position) {
    let mapper;

    if (trackerItem.get_is_separator())
        mapper = new RemoteMenuSeparatorItemMapper(trackerItem);
    else if (trackerItem.get_has_submenu())
        mapper = new RemoteMenuSubmenuItemMapper(trackerItem);
    else
        mapper = new RemoteMenuItemMapper(trackerItem);

    let item = mapper.menuItem;
    menu.addMenuItem(item, null, position);
}

function _removeItem(menu, position) {
    let items = menu._getMenuItems();
    items[position].destroy();
}

const RemoteMenuSeparatorItemMapper = new Lang.Class({
    Name: 'RemoteMenuSeparatorItemMapper',

    _init: function(trackerItem) {
        this._trackerItem = trackerItem;
        this.menuItem = new ConfigurableMenus.ConfigurableSeparatorMenuItem();
        this._trackerItem.connect('notify::label', Lang.bind(this, this._updateLabel));
        this._updateLabel();

        this.menuItem.connect('destroy', function() {
            trackerItem.run_dispose();
        });
    },

    _updateLabel: function() {
        //this.menuItem.label.text = stripMnemonics(this._trackerItem.label);
    },
});

const RequestSubMenu = new Lang.Class({
    Name: 'RequestSubMenu',
    Extends: ConfigurableMenus.ConfigurablePopupSubMenuMenuItem,

    _init: function() {
        this.parent('');
        this._requestOpen = false;
    },

    _setOpenState: function(open) {
        this.emit('request-open', open);
        this._requestOpen = open;
    },

    _getOpenState: function() {
        return this._requestOpen;
    },
});

const RemoteMenuSubmenuItemMapper = new Lang.Class({
    Name: 'RemoteMenuSubmenuItemMapper',

    _init: function(trackerItem) {
        this._trackerItem = trackerItem;
        this.menuItem = new RequestSubMenu();
        this._trackerItem.connect('notify::label', Lang.bind(this, this._updateLabel));
        this._updateLabel();

        this._tracker = Shell.MenuTracker.new_for_item_submenu(this._trackerItem,
                                                               _insertItem.bind(null, this.menuItem.menu),
                                                               _removeItem.bind(null, this.menuItem.menu));

        this.menuItem.connect('request-open', Lang.bind(this, function(menu, open) {
            this._trackerItem.request_submenu_shown(open);
        }));

        this._trackerItem.connect('notify::submenu-shown', Lang.bind(this, function() {
            this.menuItem.setSubmenuShown(this._trackerItem.get_submenu_shown());
        }));

        this.menuItem.connect('destroy', function() {
            trackerItem.run_dispose();
        });
    },

    destroy: function() {
        this._tracker.destroy();
        this.parent();
    },

    _updateLabel: function() {
        this.menuItem.setText(stripMnemonics(this._trackerItem.label));
    },
});

const RemoteMenuItemMapper = new Lang.Class({
    Name: 'RemoteMenuItemMapper',

    _init: function(trackerItem) {
        this._trackerItem = trackerItem;
        this._currentOrnament = ConfigurableMenus.OrnamentType.NONE;

        this.menuItem = new ConfigurableMenus.ConfigurableApplicationMenuItem("");

        this.menuItem.connect('activate', Lang.bind(this, function() {
            this._trackerItem.activated();
            this.menuItem.toggleOrnament();
        }));

        this._trackerItem.bind_property('visible', this.menuItem.actor, 'visible', GObject.BindingFlags.SYNC_CREATE);

        this._trackerItem.connect('notify::icon', Lang.bind(this, this._updateIcon));
        this._trackerItem.connect('notify::label', Lang.bind(this, this._updateLabel));
        this._trackerItem.connect('notify::sensitive', Lang.bind(this, this._updateSensitivity));
        this._trackerItem.connect('notify::role', Lang.bind(this, this._updateRole));
        this._trackerItem.connect('notify::toggled', Lang.bind(this, this._updateDecoration));

        this._updateIcon();
        this._updateLabel();
        this._updateSensitivity();
        this._updateRole();

        this.menuItem.connect('destroy', function() {
            trackerItem.run_dispose();
        });
    },

    _updateIcon: function() {
        this.menuItem.setGIcon(this._trackerItem.icon);
    },

    _updateLabel: function() {
        this.menuItem.setText(stripMnemonics(this._trackerItem.label));
    },

    _updateSensitivity: function() {
        this.menuItem.setSensitive(this._trackerItem.sensitive);
    },

    _updateDecoration: function() {
        let ornamentForRole = {};
        ornamentForRole[ShellMenu.MenuTrackerItemRole.RADIO] = ConfigurableMenus.OrnamentType.DOT;
        ornamentForRole[ShellMenu.MenuTrackerItemRole.CHECK] = ConfigurableMenus.OrnamentType.CHECK;

        let ornament = ConfigurableMenus.OrnamentType.NONE;
        if (this._trackerItem.toggled)
            ornament = ornamentForRole[this._trackerItem.role];

        if(ornament != ConfigurableMenus.OrnamentType.NONE)
            this.menuItem.setOrnament(ornament, true);
        else
            this.menuItem.setOrnament(ornament, false);
        this._currentOrnament = ornament;
    },

    _updateRole: function() {
        let a11yRoles = {};
        a11yRoles[ShellMenu.MenuTrackerItemRole.NORMAL] = Atk.Role.MENU_ITEM;
        a11yRoles[ShellMenu.MenuTrackerItemRole.RADIO] = Atk.Role.RADIO_MENU_ITEM;
        a11yRoles[ShellMenu.MenuTrackerItemRole.CHECK] = Atk.Role.CHECK_MENU_ITEM;

        let a11yRole = a11yRoles[this._trackerItem.role];
        this.menuItem.actor.accessible_role = a11yRole;

        this._updateDecoration();
    },
});

function RemoteMenu() {
   this._init.apply(this, arguments);
}

RemoteMenu.prototype = {
    __proto__: ConfigurableMenus.ConfigurableMenu.prototype,

    _init: function(launcher, model, actionGroup) {
        ConfigurableMenus.ConfigurableMenu.prototype._init.call (this, launcher, 0.0, St.Side.TOP, true);

        this._model = model;
        this._actionGroup = actionGroup;
        this._tracker = Shell.MenuTracker.new(this._actionGroup,
                                              this._model,
                                              null, /* action namespace */
                                              _insertItem.bind(null, this),
                                              _removeItem.bind(null, this));
    },

    destroy: function() {
        this._tracker.destroy();
        ConfigurableMenus.ConfigurableMenu.prototype.destroy.call(this);
    },
};

