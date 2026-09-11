// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsole } from './AdminConsole.js';
const { request }=vi.hoisted(()=>({request:vi.fn()}));vi.mock('../api.js',()=>({request}));
function Probe(){const l=useLocation();return <output data-testid="location">{`${l.pathname}${l.search}`}</output>};function show(path:string){return render(<MemoryRouter initialEntries={[path]}><AdminConsole/><Probe/></MemoryRouter>)}
beforeEach(()=>{request.mockReset();vi.stubGlobal('confirm',vi.fn(()=>true))});afterEach(cleanup);
describe('administrator directory tables',()=>{
 it('keeps filters, sorting, page size, and offset in the PSIU URL and request',async()=>{request.mockResolvedValue({items:[],limit:25,offset:0});show('/admin/psiu');await screen.findByLabelText('Search serial or UID');fireEvent.change(screen.getByLabelText('Search serial or UID'),{target:{value:'PS'}});await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('q=PS'));fireEvent.click(screen.getByRole('button',{name:'Sort by Firmware UID'}));await waitFor(()=>expect(screen.getByTestId('location').textContent).toContain('sortBy=uid'));expect(request).toHaveBeenCalledWith(expect.stringContaining('limit=25'))});
 it('renders separated PSIU inventory and assignment workspaces',async()=>{request.mockResolvedValue({items:[{id:'unit-1',serialNumber:'PSIU-1',uid:'uid-1',status:'enabled'}],limit:25,offset:0});show('/admin/psiu');await screen.findByText('PSIU-1');expect(screen.getByText('Inventory actions')).toBeTruthy();fireEvent.click(screen.getByText('Assign'));expect(screen.getByText('Assignment workspace: PSIU-1')).toBeTruthy();expect(screen.queryByText('Find user')).toBeNull()});
 it('renders sortable tables for list pages',async()=>{request.mockResolvedValue({items:[],limit:25,offset:0});show('/admin/samples');await screen.findByRole('table',{name:'Sample directory'});expect(screen.getAllByRole('button',{name:/Sort by/}).length).toBeGreaterThan(1);expect(screen.getAllByText('Rows per page').length).toBeGreaterThan(0)});
});
