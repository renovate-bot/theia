/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import URI from '@theia/core/lib/common/uri';
import * as React from '@theia/core/shared/react';
import { DebugConfiguration } from '../../common/debug-common';
import { DebugConfigurationManager } from '../debug-configuration-manager';
import { DebugSessionOptions, InternalDebugSessionOptions } from '../debug-session-options';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { QuickInputService } from '@theia/core/lib/browser';
import { nls } from '@theia/core/lib/common/nls';

interface IDynamicPickItem { label: string, providerType: string }

export interface DebugConfigurationSelectProps {
    manager: DebugConfigurationManager,
    quickInputService: QuickInputService,
    isMultiRoot: boolean
}

export interface DebugConfigurationSelectState {
    configsPerType: { type: string, configurations: DebugConfiguration[] }[]
}

export class DebugConfigurationSelect extends React.Component<DebugConfigurationSelectProps, DebugConfigurationSelectState> {

    protected static readonly SEPARATOR = '──────────';
    protected static readonly PICK = '__PICK__';
    private manager: DebugConfigurationManager;
    private quickInputService: QuickInputService;

    constructor(props: DebugConfigurationSelectProps) {
        super(props);
        this.manager = props.manager;
        this.quickInputService = props.quickInputService;
        this.state = {
            configsPerType: [],
        };
        this.manager.onDidConfigurationProvidersChanged(() => {
            this.refreshDebugConfigurations();
        });
    }

    componentDidMount(): void {
        this.refreshDebugConfigurations();
    }

    render(): React.ReactNode {
        return <select
            className='theia-select debug-configuration'
            value={this.currentValue}
            onChange={this.setCurrentConfiguration}
            onFocus={this.refreshDebugConfigurations}
            onBlur={this.refreshDebugConfigurations}
        >
            {this.renderOptions()}
        </select>;
    }

    protected get currentValue(): string {
        const { current } = this.manager;
        return current ? InternalDebugSessionOptions.toValue(current) : '__NO_CONF__';
    }

    protected readonly setCurrentConfiguration = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.currentTarget.value;
        if (value === '__ADD_CONF__') {
            this.manager.addConfiguration();
        } else if (value.startsWith(DebugConfigurationSelect.PICK)) {
            const providerType = this.parsePickValue(value);
            this.selectDynamicConfigFromQuickPick(providerType);
        } else {
            const [name, workspaceFolderUri, providerType] = InternalDebugSessionOptions.parseValue(value);
            this.manager.selectionChanged(this.manager.find(name, workspaceFolderUri, providerType));
        }
    };

    protected toPickValue(providerType: string): string {
        return DebugConfigurationSelect.PICK + providerType;
    }

    protected parsePickValue(value: string): string {
        return value.slice(DebugConfigurationSelect.PICK.length);
    }

    protected async selectDynamicConfigFromQuickPick(providerType: string): Promise<void> {
        const configurationsOfProviderType = this.state.configsPerType.find(entry => entry.type === providerType);
        if (!configurationsOfProviderType) {
            return;
        }
        const { configurations } = configurationsOfProviderType;

        const picks: IDynamicPickItem[] = [];
        for (const configuration of configurations) {
            picks.push({
                label: configuration.name,
                providerType
            });
        }

        if (picks.length === 0) {
            return;
        }

        const quickPick = this.quickInputService.createQuickPick<IDynamicPickItem>();
        const disposables = new DisposableCollection(quickPick);
        quickPick.busy = true;
        quickPick.placeholder = 'Select Launch Configuration';
        quickPick.show();

        const pickedItemPromise = new Promise<IDynamicPickItem | undefined>(resolve => {
            disposables.push(quickPick.onDidAccept(() => {
                resolve(quickPick.activeItems[0]);
            }));
        });

        quickPick.items = picks;
        quickPick.busy = false;
        const selected = await pickedItemPromise;

        disposables.dispose();

        if (!selected) {
            return;
        }

        this.manager.selectionChanged(this.manager.find(selected.label, undefined, selected.providerType));
    }

    protected refreshDebugConfigurations = async () => {
        const configsPerType = await this.manager.provideDynamicDebugConfigurations();
        this.setState({ configsPerType });
    };

    protected renderOptions(): React.ReactNode {
        // Add stored configurations
        const storedConfigs = Array.from(this.manager.all);

        let index = 0;

        const options: React.ReactNode[] = storedConfigs.map(config =>
            <option key={index++} value={InternalDebugSessionOptions.toValue(config)}>
                {this.toName(config, this.props.isMultiRoot)}
            </option>
        );

        // Add recently used dynamic debug configurations
        const recentDynamicOptions = this.manager.recentDynamicOptions;
        if (recentDynamicOptions.length > 0) {
            options.push(<option key={index++} disabled>{DebugConfigurationSelect.SEPARATOR}</option>);
            for (const dynamicOption of recentDynamicOptions) {
                options.push(
                    <option key={index++} value={InternalDebugSessionOptions.toValue(dynamicOption)}>
                        {`${this.toName(dynamicOption, this.props.isMultiRoot)} (${dynamicOption.providerType})`}
                    </option>
                );
            }
        }

        // Add Dynamic configuration types for quick pick selection
        let dynamicConfigSeparatorPresent = false;
        for (const { type, configurations } of this.state.configsPerType) {
            if (configurations && configurations.length > 0) {
                if (!dynamicConfigSeparatorPresent) {
                    options.push(<option key={index++} disabled>{DebugConfigurationSelect.SEPARATOR}</option>);
                    dynamicConfigSeparatorPresent = true;
                }
                options.push(
                    <option key={index++} value={`${this.toPickValue(type)}` }>{`${type}...`}</option>
                );
            }
        }

        // If No configurations
        if (options.length === 0) {
            options.push(<option key={index++} value='__NO_CONF__'>
                {nls.localize('vscode/debugActionViewItems/noConfigurations', 'No Configurations')}</option>);
        }

        // Add the option to open the configurations file
        options.push(<option key={index++} disabled>{DebugConfigurationSelect.SEPARATOR}</option>);
        options.push(<option key={index++} value='__ADD_CONF__'>
            {nls.localize('vscode/debugActionViewItems/addConfiguration', 'Add Configuration...')}</option>);

        return options;
    };

    protected toName({ configuration, workspaceFolderUri }: DebugSessionOptions, multiRoot: boolean): string {
        if (!workspaceFolderUri || !multiRoot) {
            return configuration.name;
        }
        return configuration.name + ' (' + new URI(workspaceFolderUri).path.base + ')';
    }
}
